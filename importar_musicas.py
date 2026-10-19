"""
Script de importação de músicas para o banco de dados do SingAI.

Como usar:
1. Coloque os arquivos de áudio (.mp3) na pasta musicas/
2. Coloque as letras (.txt) na pasta letras/ com o MESMO nome do áudio
   (ex: musicas/musica1.mp3  <->  letras/musica1.txt)
3. (Opcional) Preencha o dicionário INFO_MUSICAS abaixo com título/artista
   corretos. Se não preencher, o título vira o nome do arquivo.
4. Rode: python importar_musicas.py

O script:
- Insere músicas novas.
- Atualiza título/artista/letra de músicas já existentes (inclusive
  reativando, se o arquivo tiver voltado a existir).
- Marca como inativa (ativa = 0) qualquer música cujo arquivo de áudio
  não exista mais em musicas/ — sem apagar a linha, pra não quebrar o
  histórico de performances já registradas.
"""

import sqlite3
import os

# --- Configurações ---
PASTA_AUDIOS = "musicas"
PASTA_LETRAS = "letras"
BANCO = "singai.db"

# Preencha aqui se quiser título/artista customizados.
# Chave = nome do arquivo sem extensão (igual em musicas/ e letras/)
INFO_MUSICAS = {
    "eutedevoro":         {"titulo": "Eu te Devoro", "artista": "Djavan"},
    "barbiegirl":         {"titulo": "Barbie Girl", "artista": "Aqua"},
    "epitafio":           {"titulo": "Epitáfio", "artista": "Titãs"},
    "eyeofthetiger":      {"titulo": "Eye of the Tiger", "artista": "Survivor"},
    "likeastone":         {"titulo": "Like a Stone", "artista": "Audioslave"},
    "meninaveneno":       {"titulo": "Menina Veneno", "artista": "Ritchie"},
    "pescadordeilusoes":  {"titulo": "Pescador de Ilusões", "artista": "O Rappa"},
    "rapdaakatsuki":      {"titulo": "Rap da Akatsuki", "artista": "7Minutoz"},
    "primeiroserros":     {"titulo": "Primeiros Erros", "artista": "Capital Inicial"},
    "cachimbodapaz":      {"titulo": "Cachimbo da Paz", "artista": "Gabriel o Pensador"},
    "takeonme":           {"titulo": "Take On Me", "artista": "a-ha"},
    "tempoperdido":       {"titulo": "Tempo Perdido", "artista": "Legião Urbana"},
    "terradegigantes":    {"titulo": "Terra de Gigantes", "artista": "Engenheiros do Hawaii"},
    "vienna":             {"titulo": "Vienna", "artista": "Billy Joel"},
    # adicione aqui as novas músicas que substituíram as antigas
}


def garantir_colunas(conn):
    """Garante que a tabela musicas exista e tenha as colunas necessárias."""
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
    if "ativa" not in colunas_existentes:
        cursor.execute("ALTER TABLE musicas ADD COLUMN ativa INTEGER DEFAULT 1")
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
        print(f"Nenhum arquivo de áudio encontrado em '{PASTA_AUDIOS}'.")
        return

    total_inseridas = 0
    total_atualizadas = 0
    total_reativadas = 0
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

        info = INFO_MUSICAS.get(nome_base, {})
        titulo = info.get("titulo", nome_base.replace("_", " ").title())
        artista = info.get("artista", None)

        # Verifica se essa música já foi importada antes
        cursor.execute(
            "SELECT id, caminho_letra, titulo, artista, ativa FROM musicas WHERE caminho_audio = ?",
            (caminho_audio,),
        )
        existente = cursor.fetchone()

        if existente:
            id_existente, letra_atual, titulo_atual, artista_atual, ativa_atual = existente
            letra_final = caminho_letra if (tem_letra and not letra_atual) else letra_atual

            mudou_algo = (
                titulo_atual != titulo
                or artista_atual != artista
                or ativa_atual != 1
                or letra_final != letra_atual
            )

            if mudou_algo:
                cursor.execute(
                    """
                    UPDATE musicas
                    SET titulo = ?, artista = ?, caminho_letra = ?, ativa = 1
                    WHERE id = ?
                    """,
                    (titulo, artista, letra_final, id_existente),
                )
                if ativa_atual != 1:
                    total_reativadas += 1
                    print(f"[REATIVADA] '{titulo}' voltou a aparecer no catálogo.")
                else:
                    total_atualizadas += 1
                    print(f"[ATUALIZADA] '{titulo}'")
            else:
                total_puladas += 1
            continue

        cursor.execute(
            """
            INSERT INTO musicas (titulo, artista, caminho_audio, caminho_letra, ativa)
            VALUES (?, ?, ?, ?, 1)
            """,
            (titulo, artista, caminho_audio, caminho_letra),
        )
        total_inseridas += 1
        print(f"[OK] Importada: {titulo}")

    # Desativa (soft delete) qualquer música cujo arquivo não exista mais,
    # sem apagar a linha — preserva o histórico de performances já salvas.
    total_desativadas = 0
    cursor.execute("SELECT id, caminho_audio, titulo FROM musicas WHERE ativa = 1")
    for id_musica, caminho, titulo in cursor.fetchall():
        if caminho is None:
            # música sem caminho_audio no banco: nada a checar em disco,
            # a rota /musicas já ignora quem não tem caminho_audio preenchido
            continue
        if not os.path.isfile(caminho):
            cursor.execute("UPDATE musicas SET ativa = 0 WHERE id = ?", (id_musica,))
            total_desativadas += 1
            print(f"[DESATIVADA] '{titulo}' — arquivo '{caminho}' não encontrado.")

    conn.commit()
    conn.close()

    print(f"\nConcluído: {total_inseridas} inserida(s), "
          f"{total_atualizadas} atualizada(s), "
          f"{total_reativadas} reativada(s), "
          f"{total_desativadas} desativada(s), "
          f"{total_puladas} pulada(s) (sem mudança).")


if __name__ == "__main__":
    importar()
