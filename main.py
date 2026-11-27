import re
import json
import importlib
import threading
import types
from typing import Optional
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
import shutil
import os
import sqlite3
import whisper
import tqdm as _tqdm
from jiwer import wer
from fastapi.staticfiles import StaticFiles
import database

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.on_event("startup")
def iniciar_banco():
    database.criar_tabelas()


# Carrega o modelo UMA vez, quando o servidor sobe
modelo_whisper = whisper.load_model("medium")


# ---------- PROGRESSO REAL DO PROCESSAMENTO ----------
# O Whisper tem uma barra de progresso interna (tqdm) que avança conforme
# processa cada trecho do áudio. Trocamos essa barra por uma que, além de
# avançar, avisa quantos % já foram processados. O aviso vai pra um
# "callback" guardado por thread, então cada requisição reporta só o seu.
PROGRESSO = {}  # id_tarefa -> {"percentual": float, "etapa": str}
_contexto = threading.local()


class _BarraComProgresso(_tqdm.tqdm):
    def update(self, n=1):
        retorno = super().update(n)
        callback = getattr(_contexto, "callback", None)
        if callback and self.total:
            callback(min(1.0, self.n / self.total))
        return retorno


importlib.import_module("whisper.transcribe").tqdm = types.SimpleNamespace(tqdm=_BarraComProgresso)


def normalizar(texto: str) -> str:
    texto = texto.lower()
    texto = re.sub(r'[^\w\sáàâãéèêíïóôõöúçñ]', '', texto)
    texto = re.sub(r'\s+', ' ', texto).strip()
    return texto


def colapsar_repeticoes(texto: str, max_repeticoes: int = 3) -> str:
    """Rede de segurança contra loops de repetição do Whisper: se a mesma
    palavra ou sequência curta aparecer mais de `max_repeticoes` vezes
    seguidas, corta o excesso. Não deveria ser necessário com
    condition_on_previous_text=False, mas protege o WER de casos extremos."""
    palavras = texto.split()
    if not palavras:
        return texto

    resultado = []
    atual = palavras[0]
    contagem = 1
    for palavra in palavras[1:]:
        if palavra == atual:
            contagem += 1
            if contagem <= max_repeticoes:
                resultado.append(palavra)
        else:
            atual = palavra
            contagem = 1
            resultado.append(palavra)
    return " ".join(resultado)


@app.get("/")
def home():
    return {"status": "SingAI backend rodando"}


@app.post("/gravar")
async def receber_audio(audio: UploadFile = File(...)):
    caminho = os.path.join("audios", audio.filename)
    with open(caminho, "wb") as buffer:
        shutil.copyfileobj(audio.file, buffer)
    return {"mensagem": "Áudio recebido com sucesso", "arquivo": audio.filename}


@app.post("/transcrever")
async def transcrever_audio(nome_arquivo: str):
    caminho = os.path.join("audios", nome_arquivo)
    resultado = modelo_whisper.transcribe(caminho)
    return {"arquivo": nome_arquivo, "transcricao": resultado["text"]}


@app.get("/progresso/{id_tarefa}")
def obter_progresso(id_tarefa: str):
    return PROGRESSO.get(id_tarefa, {"percentual": 0, "etapa": "Iniciando..."})


# `def` (e não `async def`) de propósito: assim o FastAPI roda esta função
# numa thread separada e o servidor continua respondendo ao /progresso
# enquanto o Whisper transcreve.
@app.post("/pontuar")
def pontuar(nome_arquivo: str, musica_id: str, usuario: str, id_tarefa: Optional[str] = None):
    def avancar(percentual: float, etapa: str):
        if id_tarefa:
            PROGRESSO[id_tarefa] = {"percentual": round(percentual, 1), "etapa": etapa}

    try:
        caminho_audio = os.path.join("audios", nome_arquivo)
        caminho_letra = os.path.join("letras", f"{musica_id}.txt")

        if not os.path.exists(caminho_letra):
            return {"erro": f"Música '{musica_id}' não encontrada no catálogo"}

        avancar(3, "Carregando áudio")

        # A transcrição ocupa de 5% a 90% da barra, proporcional ao áudio já processado
        _contexto.callback = lambda fracao: avancar(5 + fracao * 85, "Transcrevendo sua voz")
        resultado = modelo_whisper.transcribe(
            caminho_audio,
            condition_on_previous_text=False,  # evita o loop de repetição entre janelas
            compression_ratio_threshold=2.2,   # mais sensível a detectar repetição e tentar de novo
            verbose=False,                     # liga a barra interna de progresso do Whisper
        )
        _contexto.callback = None
        transcricao = resultado["text"]

        avancar(90, "Comparando com a letra")
        with open(caminho_letra, "r", encoding="utf-8") as f:
            letra_referencia = f.read()

        transcricao_protegida = colapsar_repeticoes(normalizar(transcricao))
        erro = wer(normalizar(letra_referencia), transcricao_protegida)
        pontuacao = max(0, (1 - erro) * 100)
        pontuacao = round(pontuacao, 2)

        avancar(96, "Salvando seu resultado")
        database.salvar_performance(usuario, musica_id, nome_arquivo, transcricao, pontuacao)

        return {
            "usuario": usuario,
            "musica_id": musica_id,
            "transcricao": transcricao,
            "letra_referencia": letra_referencia,
            "wer": erro,
            "pontuacao": pontuacao
        }
    finally:
        _contexto.callback = None
        if id_tarefa:
            PROGRESSO.pop(id_tarefa, None)


@app.get("/musicas")
def listar_musicas():
    # Fonte única de verdade: tabela `musicas`, filtrando só as ativas
    # (a coluna `ativa` é mantida pelo importar_musicas.py — ele desliga
    # automaticamente qualquer música cujo arquivo de áudio tenha sumido
    # de musicas/, sem apagar o histórico de performances já registradas).
    conn = sqlite3.connect("singai.db")
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT titulo, artista, caminho_audio FROM musicas WHERE ativa = 1 ORDER BY titulo"
        )
        linhas = cursor.fetchall()
    finally:
        conn.close()

    musicas = []
    for titulo, artista, caminho_audio in linhas:
        if not caminho_audio:
            # música sem áudio vinculado ainda não deve aparecer no catálogo
            continue
        slug = os.path.splitext(os.path.basename(caminho_audio))[0]
        musicas.append({
            "id": slug,
            "titulo": titulo,
            "artista": artista,
        })

    return {"musicas": musicas}


# Entrega o MP3 original do catálogo (pasta musicas/) pro navegador tocar.
# Procura pelo musica_id em algumas extensões, já que o formato pode variar.
@app.get("/musica-audio/{musica_id}")
def obter_audio_musica(musica_id: str):
    extensoes = (".mp3", ".wav", ".m4a")
    for extensao in extensoes:
        caminho = os.path.join("musicas", musica_id + extensao)
        if os.path.exists(caminho):
            return FileResponse(caminho)
    return {"erro": f"Áudio de '{musica_id}' não encontrado em musicas/"}


@app.get("/sincronia/{musica_id}")
def obter_sincronia(musica_id: str):
    caminho = os.path.join("sincronia", f"{musica_id}.json")
    if not os.path.exists(caminho):
        return JSONResponse({"linhas": []}, status_code=200)
    with open(caminho, "r", encoding="utf-8") as f:
        linhas = json.load(f)
    return {"linhas": linhas}


@app.get("/historico")
def historico(usuario: str = None, limite: int = 5):
    dados = database.listar_historico(usuario=usuario, limite=limite)
    resultado = []
    for linha in dados:
        if usuario:
            resultado.append({"musica_id": linha[0], "pontuacao": linha[1], "data": linha[2]})
        else:
            resultado.append({"usuario": linha[0], "musica_id": linha[1], "pontuacao": linha[2], "data": linha[3]})
    return {"historico": resultado}


@app.get("/ranking")
def ranking(limite: int = 10):
    dados = database.ranking_usuarios(limite=limite)
    resultado = [{"usuario": linha[0], "melhor_pontuacao": linha[1]} for linha in dados]
    return {"ranking": resultado}
