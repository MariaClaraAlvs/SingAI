# SingAI — Karaokê Inteligente

Documentação do projeto: como configurar o ambiente, rodar o servidor e o que já foi feito até agora.

---

## 1. Estrutura de pastas do projeto

```
singai/
├── venv/                  → ambiente virtual Python (não mexer manualmente)
├── main.py                → backend (FastAPI) com todas as rotas
├── database.py            → funções de acesso ao banco de dados (SQLite)
├── singai.db              → arquivo do banco de dados (criado automaticamente)
├── audios/                → áudios gravados pelos usuários
├── letras/                → letras de referência de cada música (.txt)
└── static/
    ├── index.html          → estrutura da interface
    ├── style.css           → visual (cores, layout)
    └── app.js              → lógica da interface (gravação, catálogo, modal)
```

---

## 2. Como ativar o ambiente e rodar o servidor

Sempre que for trabalhar no projeto, siga esses passos, nesta ordem:

```bash
cd ~/singai
source venv/bin/activate
uvicorn main:app --reload
```

- `cd ~/singai` → entra na pasta do projeto.
- `source venv/bin/activate` → ativa o ambiente virtual (o terminal passa a mostrar `(venv)` no início da linha — é assim que você confirma que está ativado).
- `uvicorn main:app --reload` → sobe o servidor. Ele carrega o modelo Whisper na inicialização, então pode demorar alguns segundos até aparecer `Application startup complete`.

Depois disso, acessar no navegador:

```
http://127.0.0.1:8000/static/index.html   → interface principal
http://127.0.0.1:8000/docs                → documentação/teste manual das rotas da API
```

Para parar o servidor: `Ctrl + C` no terminal onde ele está rodando.

**Importante:** o venv precisa ser ativado (`source venv/bin/activate`) toda vez que abrir um terminal novo — essa ativação não é permanente, vale só para aquela sessão do terminal.

---

## 3. Dependências instaladas

Instaladas dentro do venv com `pip install`:

| Pacote | Para que serve |
|---|---|
| `fastapi` | Framework do backend |
| `uvicorn` | Servidor que roda a aplicação FastAPI |
| `python-multipart` | Necessário para receber upload de arquivos (áudio) |
| `openai-whisper` | Transcrição de voz para texto |
| `jiwer` | Cálculo do WER (Word Error Rate), usado na pontuação |

Também é necessário ter o **ffmpeg** instalado no sistema (não é pacote Python):
```bash
sudo apt install ffmpeg
```

Se precisar reinstalar tudo do zero em outra máquina:
```bash
cd ~/singai
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn python-multipart openai-whisper jiwer
```

---

## 4. Rotas da API (backend)

| Rota | Método | O que faz |
|---|---|---|
| `/` | GET | Só confirma que o backend está rodando |
| `/static/index.html` | GET | Serve a interface web |
| `/musicas` | GET | Lista os ids das músicas disponíveis (baseado nos arquivos `.txt` em `letras/`) |
| `/gravar` | POST | Recebe um arquivo de áudio e salva em `audios/` |
| `/transcrever` | POST | Transcreve um áudio já salvo, usando Whisper (parâmetro: `nome_arquivo`) |
| `/pontuar` | POST | Transcreve o áudio, compara com a letra da música e calcula a pontuação (parâmetros: `nome_arquivo`, `musica_id`) |

**Detalhes importantes do `/pontuar`:**
- Usa o modelo Whisper `"base"` com `language="pt"` (o modelo `"tiny"` testado antes dava transcrições ruins em português).
- Antes de calcular o WER, o texto é normalizado (letras minúsculas, sem pontuação) para que maiúsculas/vírgulas não prejudiquem a pontuação injustamente.
- A pontuação é calculada como `(1 - WER) * 100`, arredondada em 2 casas decimais.

---

## 5. Banco de dados (em andamento)

Criado com SQLite (não precisa de MySQL nem instalação de servidor de banco — é só um arquivo `singai.db` na pasta do projeto).

Tabela `performances`:

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | INTEGER | Chave primária, autoincremento |
| `usuario` | TEXT | Nome de quem cantou |
| `musica_id` | TEXT | Id da música (bate com o nome do arquivo em `letras/`) |
| `arquivo_audio` | TEXT | Nome do arquivo salvo em `audios/` |
| `transcricao` | TEXT | Texto transcrito pelo Whisper |
| `pontuacao` | REAL | Nota calculada (0 a 100) |
| `data` | TEXT | Data/hora do registro (preenchida automaticamente) |

Funções já criadas em `database.py`: `criar_tabela()`, `salvar_performance()`, `listar_historico()`.

**Ainda faltando (próximos passos do banco):**
- Conectar `salvar_performance()` dentro da rota `/pontuar`, para salvar automaticamente cada resultado.
- Criar uma rota `/historico` para buscar os dados salvos.
- Decidir como o nome do usuário será pedido na interface (campo fixo no topo, ou algo tipo "login" simples sem senha).
- Atualizar a interface para mostrar o histórico real (hoje o painel "Últimas músicas" mostra um texto de exemplo fixo).

---

## 6. Catálogo de músicas

Cada música precisa de um arquivo `.txt` dentro de `letras/`, com o nome no padrão `id_da_musica.txt` (minúsculo, sem espaço, use `_` no lugar de espaço). O id do arquivo é o que aparece na rota `/musicas` e é usado para os áudios também.

Exemplo:
```
letras/
├── muito_prazer.txt
└── dom_quixote.txt
```

**Ainda faltando:** adicionar as demais letras do catálogo (a ideia é ter por volta de 10 músicas) e conseguir os áudios reais cantando cada uma, para validar o sistema por completo.

---

## 7. Interface web

- Layout tipo dashboard: sidebar de navegação, catálogo de músicas em cards, painel direito com atalhos e histórico, e um modal que abre para gravar.
- Paleta de cores clara e vibrante: fundo bege (`#EFE6D8`) com blobs decorativos coloridos (coral, amarelo, turquesa, verde-limão) nos cantos, painéis internos em off-white quente (`#FFFCF5`), cards de música com gradientes coloridos variados.
- Logo "SingAI" com fonte arredondada (Google Fonts "Baloo 2"), "Sing" em preto e "AI" com efeito de gradiente colorido no texto.
- Ícones em SVG simples (sem emojis), em preto para bom contraste.
- Capa de cada música no catálogo: mostra a primeira letra do nome (sem precisar de imagens com direitos autorais).
- Gravação de áudio feita direto pelo microfone do navegador (`MediaRecorder`), funciona também em tablets/celulares acessando pelo navegador — inclusive com microfone físico de fio via adaptador, se for o caso.

---

## 8. Decisões já tomadas (para não esquecer o "porquê")

- **MVP primeiro, CREPE depois:** construir o fluxo completo de texto (Whisper + comparação com a letra) antes de somar a avaliação de afinação com CREPE, para não sobrecarregar o prazo escolar.
- **Interface web, não app nativo:** mesmo cogitando rodar num tablet, a interface web funciona igual (inclusive microfone de fio) e evita todo o trabalho extra de configurar ambiente de desenvolvimento mobile.
- **SQLite em vez de MySQL:** suficiente para o uso local e a escala do projeto escolar, sem precisar instalar/configurar um servidor de banco separado.
- **Git/GitHub para trabalhar em dupla:** escolhido em vez de sincronização automática de pasta (tipo Syncthing), por dar controle de versão e evitar perda de trabalho quando os dois mexem no projeto.

---

## 9. Trabalhando em dupla com Git/GitHub

Repositório do projeto: `https://github.com/MariaClaraAlvs/singai`

### 9.1 Configuração inicial (uma vez por pessoa/computador)

```bash
git config --global user.name "Seu Nome"
git config --global user.email "seu-email@exemplo.com"
```

### 9.2 Clonando o projeto (quem ainda não tem a pasta local)

```bash
git clone https://github.com/MariaClaraAlvs/singai.git
cd singai
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn python-multipart openai-whisper jiwer
```

(o `venv/` não vem no clone, pois está no `.gitignore` — cada pessoa cria o seu próprio ambiente local)

### 9.3 Autenticação no GitHub

O GitHub não aceita mais senha normal da conta para `git push`/`git pull` — é necessário um **Personal Access Token (PAT)**:
1. GitHub → foto de perfil → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**.
2. **Generate new token (classic)**, marcar a opção **repo**, gerar e copiar o token (só aparece uma vez).
3. Usar esse token no lugar da senha quando o terminal pedir.
4. Opcional, para não digitar toda vez: `git config --global credential.helper store`

### 9.4 Rotina de trabalho (seguir sempre nessa ordem)

**Antes de começar a mexer em qualquer coisa:**
```bash
git pull
```

**Depois de terminar uma alteração (não precisa esperar terminar tudo, pode ser por partes):**
```bash
git add .
git commit -m "descrição curta do que mudou"
git push
```

Exemplos de mensagens de commit: `"Adiciona rota de histórico"`, `"Ajusta cores da interface"`, `"Corrige bug na transcrição"`.

### 9.5 O que fica de fora do Git (`.gitignore`)

```
venv/
__pycache__/
*.pyc
.DS_Store
```

**Atenção:** `singai.db` (banco) e os arquivos de `audios/` **entram** no Git normalmente. Como são arquivos binários, se os dois editarem/gravarem ao mesmo tempo pode dar conflito que precisa ser resolvido manualmente — vale avisar um ao outro antes de mexer nessas partes.

---

## 10. Roteiro do que falta (visão geral)

1. Terminar a integração do banco de dados (salvar histórico automaticamente + rota `/historico` + campo de usuário na interface)
2. Adicionar as letras restantes no catálogo
3. Conseguir os áudios reais cantando cada música
4. Integrar o CREPE para a pontuação de afinação (evolução final, conforme o relatório)
