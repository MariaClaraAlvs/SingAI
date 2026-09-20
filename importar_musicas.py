"""
Sincroniza a tabela `musicas` com as pastas musicas/ e letras/.

Resolve duas situações ao mesmo tempo:
1. Músicas que já foram cantadas antes criaram uma linha "feia" na tabela
   automaticamente (via buscar_ou_criar_musica), com o slug como título e
   sem caminho_audio/caminho_letra. Este script identifica essas linhas
   (titulo == slug do arquivo) e as corrige no lugar, sem duplicar.
2. Músicas que nunca foram cantadas ainda não têm linha nenhuma — essas
   são inseridas do zero, como o importar_musicas.py já fazia.

Como usar:
1. Preencha o dicionário INFO_MUSICAS com titulo/artista de cada música.
2. Rode: python sincronizar_musicas.py
"""

import sqlite3
import os

PASTA_AUDIOS = "musicas"
PASTA_LETRAS = "letras"
BANCO = "singai.db"

# Preencha aqui com título/artista corretos.
# Chave = nome do arquivo sem extensão (igual em musicas/ e letras/)
INFO_MUSICAS = {
    "amorhospitalar":     {"titulo": "Amor Hospitalar", "artista": "Luchaos"},
    "barbiegirl":         {"titulo": "Barbie Girl", "artista": "Aqua"},
    "epitafio":           {"titulo": "Epitáfio", "artista": "Titãs"},
    "eyeofthetiger":      {"titulo": "Eye of the Tiger", "artista": "Survivor"},
    "likeastone":         {"titulo": "Like a Stone", "artista": "Audioslave"},
    "meninaveneno":       {"titulo": "Menina Veneno", "artista": "Ritchie"},
    "pescadordeilusoes":  {"titulo": "Pescador de Ilusões", "artista": "O Rappa"},
    "rapdaakatsuki":      {"titulo": "Rap da Akatsuki", "artista": "7Minutoz"},
    "snow":               {"titulo": "Snow (hey oh)", "artista": "Red Hot Chilli Peppers"},
    "soniferailha":       {"titulo": "Sonífera Ilha", "artista": "Titãs"},
    "takeonme":           {"titulo": "Take On Me", "artista": "a-ha"},
    "tempoperdido":       {"titulo": "Tempo Perdido", "artista": "Legião Urbana"},
    "terradegigantes":    {"titulo": "Terra de Gigantes", "artista": "Engenheiros do Hawaii"},
    "vienna":             {"titulo": "Vienna", "artista": "Billy Joel"},
}

def garantir_colunas(conn):
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS musicas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            titulo TEXT NOT NULL,
            artista TEXT
        )
        """
    )
    cursor.execute("PRAGMA table_info(musicas)")
    colunas_existentes = {row[1] for row in cursor.fetchall()}

    if "caminho_audio" not in colunas_existentes:
        cursor.execute("ALTER TABLE musicas ADD COLUMN caminho_audio TEXT")
    if "caminho_letra" not in colunas_existentes:
        cursor.execute("ALTER TABLE musicas ADD COLUMN caminho_letra TEXT")
    conn.commit()


def sincronizar():
    if not os.path.isdir(PASTA_AUDIOS):
        print(f"Pasta '{PASTA_AUDIOS}' não encontrada.")
        return

    conn = sqlite3.connect(BANCO)
    garantir_colunas(conn)
    cursor = conn.cursor()

    arquivos_audio = [
        f for f in os.listdir(PASTA_AUDIOS)
        if f.lower().endswith((".mp3", ".wav", ".m4a"))
    ]

    total_corrigidas = 0
    total_inseridas = 0
    total_puladas = 0

    for arquivo_audio in sorted(arquivos_audio):
        nome_base = os.path.splitext(arquivo_audio)[0]
        caminho_audio = os.path.join(PASTA_AUDIOS, arquivo_audio)
        caminho_letra_possivel = os.path.join(PASTA_LETRAS, nome_base + ".txt")
        tem_letra = os.path.isfile(caminho_letra_possivel)
        caminho_letra = caminho_letra_possivel if tem_letra else None

        info = INFO_MUSICAS.get(nome_base, {})
        titulo_novo = info.get("titulo", "").strip() or nome_base.replace("_", " ").title()
        artista_novo = info.get("artista", "").strip() or None

        # 1) Já tem linha com esse caminho_audio? (já sincronizada antes)
        cursor.execute("SELECT id FROM musicas WHERE caminho_audio = ?", (caminho_audio,))
        if cursor.fetchone():
            total_puladas += 1
            continue

        # 2) Tem linha "feia" criada pelo gameplay (titulo == slug)?
        cursor.execute("SELECT id FROM musicas WHERE titulo = ?", (nome_base,))
        linha_feia = cursor.fetchone()

        if linha_feia:
            cursor.execute(
                """
                UPDATE musicas
                SET titulo = ?, artista = ?, caminho_audio = ?, caminho_letra = ?
                WHERE id = ?
                """,
                (titulo_novo, artista_novo, caminho_audio, caminho_letra, linha_feia[0]),
            )
            total_corrigidas += 1
            print(f"[CORRIGIDA] '{nome_base}' -> '{titulo_novo}'")
        else:
            cursor.execute(
                """
                INSERT INTO musicas (titulo, artista, caminho_audio, caminho_letra)
                VALUES (?, ?, ?, ?)
                """,
                (titulo_novo, artista_novo, caminho_audio, caminho_letra),
            )
            total_inseridas += 1
            print(f"[NOVA] Importada: '{titulo_novo}'")

    conn.commit()
    conn.close()

    print(f"\nConcluído: {total_corrigidas} corrigida(s), "
          f"{total_inseridas} nova(s) inserida(s), "
          f"{total_puladas} já sincronizada(s) antes.")


if __name__ == "__main__":
    sincronizar()
