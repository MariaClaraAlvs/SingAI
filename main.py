import re
from fastapi import FastAPI, UploadFile, File
import shutil
import os
import whisper
from jiwer import wer
from fastapi.staticfiles import StaticFiles

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

# Carrega o modelo UMA vez, quando o servidor sobe
modelo_whisper = whisper.load_model("medium")

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
    resultado = modelo_whisper.transcribe(caminho, language="pt")
    return {"arquivo": nome_arquivo, "transcricao": resultado["text"]}

@app.post("/pontuar")
async def pontuar(nome_arquivo: str, musica_id: str):
    caminho_audio = os.path.join("audios", nome_arquivo)
    caminho_letra = os.path.join("letras", f"{musica_id}.txt")

    if not os.path.exists(caminho_letra):
        return {"erro": f"Música '{musica_id}' não encontrada no catálogo"}

    resultado = modelo_whisper.transcribe(caminho_audio, language="pt")
    transcricao = resultado["text"]

    with open(caminho_letra, "r", encoding="utf-8") as f:
        letra_referencia = f.read()

    erro = wer(normalizar(letra_referencia), normalizar(transcricao))
    pontuacao = max(0, (1 - erro) * 100)

    return {
        "musica_id": musica_id,
        "transcricao": transcricao,
        "letra_referencia": letra_referencia,
        "wer": erro,
        "pontuacao": round(pontuacao, 2)
    }

@app.get("/musicas")
def listar_musicas():
    arquivos = os.listdir("letras")
    musicas = [nome.replace(".txt", "") for nome in arquivos if nome.endswith(".txt")]
    return {"musicas": musicas}
