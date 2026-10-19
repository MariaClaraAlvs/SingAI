import re
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import FileResponse
import shutil
import os
import sqlite3
import whisper
from jiwer import wer
from fastapi.staticfiles import StaticFiles
import database

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.on_event("startup")
def iniciar_banco():
    database.criar_tabelas()


# Carrega o modelo UMA vez, quando o servidor sobe
modelo_whisper = whisper.load_model("turbo")


def normalizar(texto: str) -> str:
    texto = texto.lower()
    texto = re.sub(r'[^\w\sáàâãéèêíïóôõöúçñ]', '', texto)
    texto = re.sub(r'\s+', ' ', texto).strip()
    return texto


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


@app.post("/pontuar")
async def pontuar(nome_arquivo: str, musica_id: str, usuario: str):
    caminho_audio = os.path.join("audios", nome_arquivo)
    caminho_letra = os.path.join("letras", f"{musica_id}.txt")

    if not os.path.exists(caminho_letra):
        return {"erro": f"Música '{musica_id}' não encontrada no catálogo"}

    resultado = modelo_whisper.transcribe(caminho_audio)
    transcricao = resultado["text"]

    with open(caminho_letra, "r", encoding="utf-8") as f:
        letra_referencia = f.read()

    erro = wer(normalizar(letra_referencia), normalizar(transcricao))
    pontuacao = max(0, (1 - erro) * 100)
    pontuacao = round(pontuacao, 2)

    database.salvar_performance(usuario, musica_id, nome_arquivo, transcricao, pontuacao)

    return {
        "usuario": usuario,
        "musica_id": musica_id,
        "transcricao": transcricao,
        "letra_referencia": letra_referencia,
        "wer": erro,
        "pontuacao": pontuacao
    }


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
