import sqlite3

BANCO = "singai.db"


def conectar():
    return sqlite3.connect(BANCO)


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
            nome TEXT NOT NULL UNIQUE,
            arquivo_letra TEXT NOT NULL,
            arquivo_instrumental TEXT
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS performances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            musica_id INTEGER NOT NULL,
            arquivo_audio TEXT NOT NULL,
            transcricao TEXT,
            pontuacao REAL NOT NULL,
            data TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
            FOREIGN KEY (musica_id) REFERENCES musicas(id)
        )
    """)

    conexao.commit()
    conexao.close()


def obter_ou_criar_usuario(nome):
    conexao = conectar()
    cursor = conexao.cursor()
    cursor.execute("SELECT id FROM usuarios WHERE nome = ?", (nome,))
    linha = cursor.fetchone()
    if linha:
        usuario_id = linha[0]
    else:
        cursor.execute("INSERT INTO usuarios (nome) VALUES (?)", (nome,))
        conexao.commit()
        usuario_id = cursor.lastrowid
    conexao.close()
    return usuario_id


def obter_ou_criar_musica(musica_slug):
    """musica_slug é o id usado nos arquivos (ex: 'dom_quixote'),
    que também é o nome do arquivo de letra em letras/."""
    conexao = conectar()
    cursor = conexao.cursor()
    cursor.execute("SELECT id FROM musicas WHERE nome = ?", (musica_slug,))
    linha = cursor.fetchone()
    if linha:
        musica_id = linha[0]
    else:
        arquivo_letra = f"{musica_slug}.txt"
        cursor.execute(
            "INSERT INTO musicas (nome, arquivo_letra) VALUES (?, ?)",
            (musica_slug, arquivo_letra)
        )
        conexao.commit()
        musica_id = cursor.lastrowid
    conexao.close()
    return musica_id


def salvar_performance(usuario_nome, musica_slug, arquivo_audio, transcricao, pontuacao):
    usuario_id = obter_ou_criar_usuario(usuario_nome)
    musica_id = obter_ou_criar_musica(musica_slug)

    conexao = conectar()
    cursor = conexao.cursor()
    cursor.execute("""
        INSERT INTO performances (usuario_id, musica_id, arquivo_audio, transcricao, pontuacao)
        VALUES (?, ?, ?, ?, ?)
    """, (usuario_id, musica_id, arquivo_audio, transcricao, pontuacao))
    conexao.commit()
    conexao.close()


def listar_historico(usuario_nome=None, limite=10):
    conexao = conectar()
    cursor = conexao.cursor()

    if usuario_nome:
        cursor.execute("""
            SELECT musicas.nome, performances.pontuacao, performances.data
            FROM performances
            JOIN musicas ON performances.musica_id = musicas.id
            JOIN usuarios ON performances.usuario_id = usuarios.id
            WHERE usuarios.nome = ?
            ORDER BY performances.data DESC
            LIMIT ?
        """, (usuario_nome, limite))
    else:
        cursor.execute("""
            SELECT usuarios.nome, musicas.nome, performances.pontuacao, performances.data
            FROM performances
            JOIN musicas ON performances.musica_id = musicas.id
            JOIN usuarios ON performances.usuario_id = usuarios.id
            ORDER BY performances.data DESC
            LIMIT ?
        """, (limite,))

    resultado = cursor.fetchall()
    conexao.close()
    return resultado


criar_tabelas()
