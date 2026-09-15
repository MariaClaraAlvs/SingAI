import whisper

modelo = whisper.load_model("small")
resultado = modelo.transcribe("audios/voz_mariaclara.wav", language="pt")
print(resultado["text"])
