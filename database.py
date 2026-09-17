import sqlite3


def conectar():
    return sqlite3.connect("singai.db")


def criar_tabelas():
    conexao = conectar()
    cursor = conexao.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL UNIQUE
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS musicas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            titulo TEXT NOT NULL,
            artista TEXT
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS performances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            musica_id INTEGER NOT NULL,
            arquivo_audio TEXT NOT NULL,
            transcricao TEXT,
            pontuacao REAL,
            data TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
            FOREIGN KEY (musica_id) REFERENCES musicas(id)
        )
    """)

    conexao.commit()
    conexao.close()


def buscar_ou_criar_usuario(nome):
    conexao = conectar()
    cursor = conexao.cursor()

    cursor.execute("SELECT id FROM usuarios WHERE nome = ?", (nome,))
    resultado = cursor.fetchone()

    if resultado:
        usuario_id = resultado[0]
    else:
        cursor.execute("INSERT INTO usuarios (nome) VALUES (?)", (nome,))
        conexao.commit()
        usuario_id = cursor.lastrowid

    conexao.close()
    return usuario_id


def buscar_ou_criar_musica(titulo, artista=None):
    conexao = conectar()
    cursor = conexao.cursor()

    cursor.execute("SELECT id FROM musicas WHERE titulo = ?", (titulo,))
    resultado = cursor.fetchone()

    if resultado:
        musica_id = resultado[0]
    else:
        cursor.execute(
            "INSERT INTO musicas (titulo, artista) VALUES (?, ?)",
            (titulo, artista)
        )
        conexao.commit()
        musica_id = cursor.lastrowid

    conexao.close()
    return musica_id


def salvar_performance(usuario, musica_titulo, arquivo_audio, transcricao, pontuacao, artista=None):
    usuario_id = buscar_ou_criar_usuario(usuario)
    musica_id = buscar_ou_criar_musica(musica_titulo, artista)

    conexao = conectar()
    cursor = conexao.cursor()
    cursor.execute("""
        INSERT INTO performances (usuario_id, musica_id, arquivo_audio, transcricao, pontuacao)
        VALUES (?, ?, ?, ?, ?)
    """, (usuario_id, musica_id, arquivo_audio, transcricao, pontuacao))
    conexao.commit()
    conexao.close()


def listar_historico(usuario=None, limite=10):
    conexao = conectar()
    cursor = conexao.cursor()

    if usuario:
        cursor.execute("""
            SELECT m.titulo, p.pontuacao, p.data
            FROM performances p
            JOIN usuarios u ON u.id = p.usuario_id
            JOIN musicas m ON m.id = p.musica_id
            WHERE u.nome = ?
            ORDER BY p.data DESC
            LIMIT ?
        """, (usuario, limite))
    else:
        cursor.execute("""
            SELECT u.nome, m.titulo, p.pontuacao, p.data
            FROM performances p
            JOIN usuarios u ON u.id = p.usuario_id
            JOIN musicas m ON m.id = p.musica_id
            ORDER BY p.data DESC
            LIMIT ?
        """, (limite,))

    resultado = cursor.fetchall()
    conexao.close()
    return resultado
