import re
import json
import importlib
import math
import threading
import time
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


# ---------- PROGRESSO DO PROCESSAMENTO ----------
# O Whisper só avisa de verdade quando termina cada janela de 30 s de áudio, e
# as marcas de tempo que ele gera dentro da janela são poucas em música (às
# vezes só no começo e no fim). Por isso o progresso combina:
#   1) ÂNCORAS REAIS: frames de áudio já concluídos (barra interna do Whisper)
#      e até onde as marcas de tempo <|2.40|>... já chegaram na janela atual;
#   2) ESTIMATIVA ENTRE ÂNCORAS: dentro da janela em andamento, avança no ritmo
#      medido nas janelas anteriores (na 1ª janela, uma curva suave), sem nunca
#      passar de 95% da janela até ela terminar de verdade.
# O percentual é calculado na hora em que o navegador pergunta (/progresso) e
# nunca anda para trás.
PROGRESSO = {}  # id_tarefa -> _Acompanhamento
_contexto = threading.local()

FRAMES_POR_SEGUNDO = 100   # Whisper: 16000 Hz / salto de 160 amostras
JANELA_FRAMES = 3000       # janela de 30 s
TOKEN_TEMPO_INICIAL = modelo_whisper.dims.n_vocab - 1501  # id do token <|0.00|> (os 1501 últimos ids são tempos)
INICIO_TRANSCRICAO = 5     # a transcrição ocupa de 5% a 90% da barra
FIM_TRANSCRICAO = 90

# Ritmo da transcrição nesta máquina (segundos por frame de áudio). Começa com um
# palpite pelo tipo de dispositivo e é recalibrado com o tempo real de cada
# transcrição concluída, então as próximas barras ficam cada vez mais fiéis.
_dispositivo = getattr(getattr(modelo_whisper, "device", None), "type", "cpu")
_RITMO = {"segundos_por_frame": 0.001 if _dispositivo == "cuda" else 0.008, "calibrado": False}


class _Acompanhamento:
    """Estado de progresso de uma pontuação em andamento."""

    def __init__(self):
        self.etapa = "Iniciando..."
        self.fixo = 0.0             # percentual das etapas fora da transcrição
        self.transcrevendo = False
        self.total = 0              # frames de áudio a transcrever
        self.base = 0               # frames de janelas já concluídas
        self.dentro = 0.0           # segundos já alcançados na janela atual (marcas de tempo)
        self.inicio = 0.0           # quando a transcrição começou
        self.inicio_janela = 0.0    # quando a janela atual começou
        self.maior = 0.0            # a barra nunca anda para trás

    def definir(self, etapa: str, fixo: float):
        self.etapa = etapa
        self.fixo = fixo
        self.transcrevendo = False

    def registrar_ritmo(self):
        """Ao fim da transcrição, guarda o ritmo real para calibrar as próximas barras."""
        if not self.total or not self.inicio:
            return
        medido = (time.monotonic() - self.inicio) / self.total
        if medido <= 0:
            return
        if _RITMO["calibrado"]:
            _RITMO["segundos_por_frame"] = 0.5 * _RITMO["segundos_por_frame"] + 0.5 * medido
        else:
            _RITMO["segundos_por_frame"] = medido
            _RITMO["calibrado"] = True

    def percentual(self) -> float:
        if not self.transcrevendo or not self.total:
            valor = self.fixo
        else:
            decorrido = time.monotonic() - self.inicio_janela
            tamanho = min(JANELA_FRAMES, self.total - self.base)  # a última janela pode ser menor
            medido = self.dentro * FRAMES_POR_SEGUNDO              # âncora real: marcas de tempo
            if self.base > 0:
                # ritmo real desta transcrição, medido nas janelas já concluídas
                segundos_por_frame = (self.inicio_janela - self.inicio) / self.base
            else:
                segundos_por_frame = _RITMO["segundos_por_frame"]  # ritmo calibrado nas transcrições anteriores
            tempo_esperado = segundos_por_frame * tamanho
            andamento = decorrido / tempo_esperado if tempo_esperado > 0 else 0
            # linear até 85% da janela; depois desacelera sem nunca parar (a janela pode demorar mais que o previsto)
            if andamento <= 0.85:
                estimado = andamento * tamanho
            else:
                estimado = (0.85 + 0.10 * (1 - math.exp(-(andamento - 0.85) / 0.5))) * tamanho
            dentro_da_janela = min(0.95 * tamanho, max(medido, estimado))
            fracao = (self.base + dentro_da_janela) / self.total
            valor = INICIO_TRANSCRICAO + (FIM_TRANSCRICAO - INICIO_TRANSCRICAO) * fracao
        self.maior = max(self.maior, valor)
        return round(self.maior, 1)


class _BarraComProgresso(_tqdm.tqdm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        acompanhamento = getattr(_contexto, "acompanhamento", None)
        if acompanhamento is not None:
            agora = time.monotonic()
            acompanhamento.total = self.total or 0
            acompanhamento.base = 0
            acompanhamento.dentro = 0.0
            acompanhamento.inicio = acompanhamento.inicio_janela = agora
            acompanhamento.etapa = "Transcrevendo sua voz"
            acompanhamento.transcrevendo = True

    def update(self, n=1):
        retorno = super().update(n)
        acompanhamento = getattr(_contexto, "acompanhamento", None)
        if acompanhamento is not None:
            acompanhamento.base = self.n                      # janelas já concluídas
            acompanhamento.dentro = 0.0                       # começa a próxima janela
            acompanhamento.inicio_janela = time.monotonic()
        return retorno


def _acompanhar_decodificador(modulo, argumentos, saida):
    acompanhamento = getattr(_contexto, "acompanhamento", None)
    if acompanhamento is None:
        return
    try:
        ultimo_token = argumentos[0][0, -1].item()
        if ultimo_token >= TOKEN_TEMPO_INICIAL:
            segundos = (ultimo_token - TOKEN_TEMPO_INICIAL) * 0.02
            if segundos > acompanhamento.dentro:  # nunca recua (o Whisper às vezes decodifica de novo)
                acompanhamento.dentro = segundos
    except Exception:
        pass  # acompanhar o progresso nunca pode derrubar a transcrição


importlib.import_module("whisper.transcribe").tqdm = types.SimpleNamespace(tqdm=_BarraComProgresso)
modelo_whisper.decoder.register_forward_hook(_acompanhar_decodificador)


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
    acompanhamento = PROGRESSO.get(id_tarefa)
    if acompanhamento is None:
        return {"percentual": 0, "etapa": "Iniciando..."}
    return {"percentual": acompanhamento.percentual(), "etapa": acompanhamento.etapa}


# `def` (e não `async def`) de propósito: assim o FastAPI roda esta função
# numa thread separada e o servidor continua respondendo ao /progresso
# enquanto o Whisper transcreve.
@app.post("/pontuar")
def pontuar(nome_arquivo: str, musica_id: str, usuario: str, id_tarefa: Optional[str] = None):
    acompanhamento = _Acompanhamento()
    if id_tarefa:
        PROGRESSO[id_tarefa] = acompanhamento
    _contexto.acompanhamento = acompanhamento

    try:
        caminho_audio = os.path.join("audios", nome_arquivo)
        caminho_letra = os.path.join("letras", f"{musica_id}.txt")

        if not os.path.exists(caminho_letra):
            return {"erro": f"Música '{musica_id}' não encontrada no catálogo"}

        acompanhamento.definir("Carregando áudio", 3)

        # A barra passa a ser calculada pelo _Acompanhamento assim que o Whisper começa a transcrever
        resultado = modelo_whisper.transcribe(
            caminho_audio,
            condition_on_previous_text=False,  # evita o loop de repetição entre janelas
            compression_ratio_threshold=2.2,   # mais sensível a detectar repetição e tentar de novo
            verbose=False,                     # liga a barra interna de progresso do Whisper
        )
        transcricao = resultado["text"]

        acompanhamento.registrar_ritmo()
        acompanhamento.definir("Comparando com a letra", FIM_TRANSCRICAO)
        with open(caminho_letra, "r", encoding="utf-8") as f:
            letra_referencia = f.read()

        transcricao_protegida = colapsar_repeticoes(normalizar(transcricao))
        erro = wer(normalizar(letra_referencia), transcricao_protegida)
        pontuacao = max(0, (1 - erro) * 100)
        pontuacao = round(pontuacao, 2)

        acompanhamento.definir("Salvando seu resultado", 96)
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
        _contexto.acompanhamento = None
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
