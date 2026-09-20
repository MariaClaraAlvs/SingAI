"""
Script de importação de músicas para o banco de dados do Desafina.

Como usar:
1. Coloque os arquivos de áudio (.mp3) na pasta audios/
2. Coloque as letras (.txt) na pasta letras/ com o MESMO nome do áudio
   (ex: audios/musica1.mp3  <->  letras/musica1.txt)
3. (Opcional) Preencha o dicionário INFO_MUSICAS abaixo com título/artista
   corretos. Se não preencher, o título vira o nome do arquivo.
4. Rode: python importar_musicas.py
"""

import sqlite3
import os

# --- Configurações ---
PASTA_AUDIOS = "musicas"
PASTA_LETRAS = "letras"
BANCO = "banco.db"

# Preencha aqui se quiser título/artista customizados.
# Chave = nome do arquivo sem extensão (igual em audios/ e letras/)
NFO_MUSICAS = {
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
    """Garante que a tabela musicas exista e tenha as colunas necessárias."""
    cursor = conn.cursor()

    # Cria a tabela se ainda não existir (mesma estrutura do database.py)
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


def importar():
    if not os.path.isdir(PASTA_AUDIOS):
        print(f"Pasta '{PASTA_AUDIOS}' não encontrada.")
        return

    conn = sqlite3.connect(BANCO)
    garantir_colunas(conn)
    cursor = conn.cursor()

    arquivos_audio = [f for f in os.listdir(PASTA_AUDIOS) if f.lower().endswith((".mp3", ".wav", ".m4a"))]

    if not arquivos_audio:
        print(f"Nenhum arquivo .mp3 encontrado em '{PASTA_AUDIOS}'.")
        return

    total_inseridas = 0
    total_atualizadas = 0
    total_puladas = 0

    for arquivo_audio in sorted(arquivos_audio):
        nome_base = os.path.splitext(arquivo_audio)[0]
        caminho_audio = os.path.join(PASTA_AUDIOS, arquivo_audio)
        caminho_letra_possivel = os.path.join(PASTA_LETRAS, nome_base + ".txt")
        tem_letra = os.path.isfile(caminho_letra_possivel)
        caminho_letra = caminho_letra_possivel if tem_letra else None

        if not tem_letra:
            print(f"[SEM LETRA] '{arquivo_audio}' ainda não tem letra em "
                  f"'{caminho_letra_possivel}'. Importando mesmo assim.")

        # Verifica se essa música já foi importada antes
        cursor.execute(
            "SELECT id, caminho_letra FROM musicas WHERE caminho_audio = ?",
            (caminho_audio,),
        )
        existente = cursor.fetchone()

        if existente:
            id_existente, letra_atual = existente
            # Se já existe mas ainda não tinha letra e agora achamos uma, atualiza
            if not letra_atual and tem_letra:
                cursor.execute(
                    "UPDATE musicas SET caminho_letra = ? WHERE id = ?",
                    (caminho_letra, id_existente),
                )
                total_atualizadas += 1
                print(f"[LETRA ADICIONADA] '{arquivo_audio}' agora tem letra vinculada.")
            else:
                total_puladas += 1
            continue

        info = INFO_MUSICAS.get(nome_base, {})
        titulo = info.get("titulo", nome_base.replace("_", " ").title())
        artista = info.get("artista", None)

        cursor.execute(
            """
            INSERT INTO musicas (titulo, artista, caminho_audio, caminho_letra)
            VALUES (?, ?, ?, ?)
            """,
            (titulo, artista, caminho_audio, caminho_letra),
        )
        total_inseridas += 1
        print(f"[OK] Importada: {titulo}")

    conn.commit()
    conn.close()

    print(f"\nConcluído: {total_inseridas} inserida(s), "
          f"{total_atualizadas} atualizada(s) com letra nova, "
          f"{total_puladas} pulada(s) (sem mudança).")


if __name__ == "__main__":
    importar()
