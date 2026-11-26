SingAI --- Karaokê Inteligente
Documentação do projeto: como configurar o ambiente, rodar o servidor e o que já foi feito até agora.

## 1. Estrutura de pastas do projeto

    singai/
    ├── venv/                  → ambiente virtual Python (não mexer manualmente)
    ├── main.py                → backend (FastAPI) com todas as rotas
    ├── database.py            → funções de acesso ao banco de dados (SQLite)
    ├── singai.db              → arquivo do banco de dados (criado automaticamente)
    ├── importar_musicas.py    → script que popula/atualiza a tabela `musicas` a partir de musicas/ e letras/
    ├── musicas/                → MP3s originais do catálogo (o que a pessoa vai cantar em cima)
    ├── audios/                → áudios gravados pelos usuários
    ├── letras/                → letras de referência de cada música (.txt), usadas no cálculo do WER
    ├── sincronia/              → um .json por música com os tempos de cada linha da letra, usado pro teleprompter em tempo real
    ├── docs/
    │   └── database-schema.svg → diagrama do banco de dados (usado no README)
    └── static/
        ├── index.html          → estrutura da interface
        ├── style.css           → visual (paleta azul/branco, telas, modal, tela de resultado)
        ├── app.js              → lógica da interface (gravação, catálogo, sincronia, resultado)
        ├── logo_singai.png     → logo usada no sidebar e na tela de abertura
        └── capas/              → capas das músicas do catálogo (.jpg, mesmo slug do áudio)

Atenção pra não confundir: `musicas/` guarda os MP3s originais do catálogo; `audios/` guarda as gravações que os próprios usuários fazem ao cantar.

## 2. Como ativar o ambiente e rodar o servidor

Sempre que for trabalhar no projeto, siga esses passos, nesta ordem:

``` bash
cd ~/singai
source venv/bin/activate
uvicorn main:app --reload
```

- `cd ~/singai` → entra na pasta do projeto (confira que não está dentro de `static/` ou de outra subpasta — já aconteceu de o `uvicorn` falhar por isso).
- `source venv/bin/activate` → ativa o ambiente virtual (o terminal passa a mostrar `(venv)` no início da linha).
- `uvicorn main:app --reload` → sobe o servidor. Ele carrega o modelo Whisper na inicialização, então pode demorar alguns segundos até aparecer `Application startup complete`.

Depois disso, acessar no navegador:

    http://127.0.0.1:8000/static/index.html   → interface principal
    http://127.0.0.1:8000/docs                → documentação/teste manual das rotas da API

Para parar o servidor: `Ctrl + C` no terminal onde ele está rodando.

**Se uma mudança no `app.js`/`style.css`/`index.html` não aparecer na tela:** o `--reload` só reinicia o Python; arquivos estáticos (CSS/JS/HTML) são servidos direto do disco a cada request, então o culpado quase sempre é o **cache do navegador**. Dá um `Ctrl+Shift+R` antes de desconfiar de outra coisa.

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

``` bash
sudo apt install ffmpeg
```

Se precisar reinstalar tudo do zero em outra máquina:

``` bash
cd ~/singai
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn python-multipart openai-whisper jiwer
```

## 4. Rotas da API (backend)

| Rota | Método | O que faz |
|---|---|---|
| `/` | GET | Só confirma que o backend está rodando |
| `/static/index.html` | GET | Serve a interface web |
| `/musicas` | GET | Lista as músicas ativas do catálogo, lendo da tabela `musicas` (título, artista, id/slug) |
| `/musica-audio/{musica_id}` | GET | Entrega o MP3 original do catálogo (pasta `musicas/`), pra tocar no palco |
| `/sincronia/{musica_id}` | GET | Devolve os tempos de cada linha da letra (lê `sincronia/{musica_id}.json`); se não existir, devolve lista vazia sem erro |
| `/gravar` | POST | Recebe um arquivo de áudio e salva em `audios/` |
| `/transcrever` | POST | Transcreve um áudio já salvo, usando Whisper (parâmetro: `nome_arquivo`) |
| `/pontuar` | POST | Transcreve o áudio, compara com a letra da música e calcula a pontuação (parâmetros: `nome_arquivo`, `musica_id`, `usuario`) |
| `/historico` | GET | Lista as últimas performances registradas (parâmetros opcionais: `usuario`, `limite`, padrão 5) |
| `/ranking` | GET | Lista a melhor pontuação de cada usuário (parâmetro opcional: `limite`, padrão 10) |

**Detalhes importantes do `/pontuar`:**
- Usa o modelo Whisper carregado uma vez na inicialização do servidor.
- A chamada ao Whisper usa `condition_on_previous_text=False` e `compression_ratio_threshold=2.2` — isso evita um loop de repetição conhecido do modelo (ele pode travar repetindo um trecho da letra dezenas de vezes, principalmente em refrões repetidos de verdade na música). Como rede de segurança extra, a transcrição passa por `colapsar_repeticoes()` antes do cálculo do WER, que corta qualquer sequência de mais de 3 repetições seguidas da mesma palavra.
- Antes de calcular o WER, o texto é normalizado (minúsculas, sem pontuação) para que maiúsculas/vírgulas não prejudiquem a pontuação injustamente.
- A pontuação é calculada como `(1 - WER) * 100`, arredondada em 2 casas decimais.

## 5. Banco de dados

Criado com SQLite (`singai.db`, na raiz do projeto).

### 5.1 Tabela `usuarios`
| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | INTEGER | Chave primária, autoincremento |
| `nome` | TEXT | Nome de quem canta (único) |

### 5.2 Tabela `musicas`
| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | INTEGER | Chave primária, autoincremento |
| `titulo` | TEXT | Título da música |
| `artista` | TEXT | Artista (opcional) |
| `caminho_audio` | TEXT | Caminho do MP3 original em `musicas/` |
| `caminho_letra` | TEXT | Caminho do `.txt` da letra em `letras/` (pode ficar em branco até a letra ser adicionada) |
| `ativa` | INTEGER | `1` = aparece no catálogo, `0` = "soft delete" (ver seção 5.5) |

### 5.3 Tabela `performances`
| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | INTEGER | Chave primária, autoincremento |
| `usuario_id` | INTEGER | Chave estrangeira → `usuarios.id` |
| `musica_id` | INTEGER | Chave estrangeira → `musicas.id` |
| `arquivo_audio` | TEXT | Nome do arquivo salvo em `audios/` |
| `transcricao` | TEXT | Texto transcrito pelo Whisper |
| `pontuacao` | REAL | Nota calculada (0 a 100) |
| `data` | TEXT | Data/hora do registro (preenchida automaticamente) |

### 5.4 Funções em `database.py`
- `criar_tabelas()` — cria as tabelas (chamada automaticamente no `startup` do FastAPI).
- `buscar_ou_criar_usuario(nome)` / `buscar_ou_criar_musica(titulo, artista)` — evitam duplicar usuário/música.
- `salvar_performance(...)` — resolve os IDs por trás dos panos e insere a performance.
- `listar_historico(usuario=None, limite=10)` — histórico com `JOIN`, trazendo nome do usuário e título da música.
- `ranking_usuarios(limite=10)` — melhor pontuação de cada usuário.

### 5.5 Importação e manutenção do catálogo (`importar_musicas.py`)
Script separado (fora do `main.py`) que sincroniza a tabela `musicas` com o que está fisicamente em `musicas/` e `letras/`:
- Insere músicas novas (usando `INFO_MUSICAS` pra título/artista bonitos, com fallback pro nome do arquivo).
- **Atualiza** título, artista e letra de músicas que já existiam (antes só atualizava a letra — isso já gerou bug de música com nome errado persistindo depois de trocar o arquivo).
- **Desativa automaticamente** (`ativa = 0`) qualquer música cujo arquivo de áudio sumiu de `musicas/` — sem apagar a linha do banco, pra não quebrar o histórico de quem já cantou aquela música (um "soft delete"). Reativa sozinha se o arquivo voltar.
- Uso: `python importar_musicas.py`, com o venv ativado, na raiz do projeto. Rodar de novo depois de trocar qualquer música do catálogo.

> **Nota sobre nomenclatura:** o `musica_id` que circula pelo `main.py` e pelo `app.js` é o *slug* do arquivo (ex: `"cachimbodapaz"`), não o `id` numérico da tabela `musicas`. A rota `/musicas` já faz essa ponte: busca os dados na tabela, mas devolve pro frontend o slug derivado de `caminho_audio` como `id`.

## 6. Catálogo de músicas

Pra adicionar/trocar uma música:
1. Coloque o MP3 em `musicas/` e, se tiver, a letra em `letras/` — ambos com o mesmo nome de arquivo (slug: minúsculo, sem espaço).
2. (Opcional) adicione título/artista bonitos em `INFO_MUSICAS`, dentro de `importar_musicas.py`.
3. Rode `python importar_musicas.py`.
4. Se quiser a capa aparecendo no catálogo, salve a imagem em `static/capas/{slug}.jpg` — se não existir, a interface cai automaticamente num fallback com a primeira letra do título.
5. Pra sincronizar a letra em tempo real (linha destacada enquanto a música toca), crie `sincronia/{slug}.json` — veja a seção 7.3.

## 7. Interface web

### 7.1 Visual
- Paleta principal **azul e branco** (variáveis CSS no topo do `style.css`, fácil de reajustar o tom). Alguns elementos têm cor própria por serem indicadores semânticos, não de marca: medalhas do ranking (ouro/prata/bronze) e o vermelho do botão "Parar gravação".
- Fonte "Baloo 2" (Google Fonts) pro texto de destaque, mantendo a identidade visual original do projeto.
- Logo em imagem (`logo_singai.png`), com animação de flutuar no sidebar e na tela de abertura.

### 7.2 Telas e fluxo
- **Tela de abertura (splash):** logo animada + botão "Começar a cantar".
- **Home:** faixa de destaque + catálogo em cards grandes (3 por linha, capa quadrada grande, título e artista). A busca foi removida por não estar funcional.
- **Perfil:** digita o nome e vê histórico + estatísticas (total de performances, melhor pontuação, média).
- **Ranking:** melhor pontuação de cada usuário, com medalhas pros 3 primeiros.
- **Modal "Quem vai cantar?":** aparece uma vez por sessão, antes do palco, pedindo o nome de quem vai cantar. Depois disso o nome fica guardado em memória (`nomeUsuarioAtual`) e os próximos cliques vão direto pro palco; dá pra trocar o nome a qualquer momento pelo link "trocar" dentro do palco.
- **Modal "palco" (gravação):** tela escura e imersiva, diferente do resto do app (clara). Mostra capa/título/artista da música, a letra sincronizada com rolagem automática até a linha atual, um disco de vinil que gira enquanto o instrumental toca, e o botão de play/pause customizado pro instrumental (os controles nativos do `<audio>` ficam escondidos).
  - O instrumental **não toca sozinho** ao abrir o modal — só começa quando o usuário aperta "Gravar" (nesse momento ele reinicia do zero, sincronizado com o início da gravação). Para automaticamente ao apertar "Parar", ao confirmar o envio ou ao descartar a gravação.
  - Depois de parar de gravar, aparece uma **confirmação com prévia**: o usuário ouve o que gravou e escolhe "Usar essa gravação" (só aí processa) ou "Gravar de novo" (descarta sem gastar chamada nenhuma ao Whisper).
- **Tela de resultado:** uma tela separada (não é mais texto dentro do modal) que aparece depois da pontuação ser calculada. Mostra porcentagem grande, estrelas (0 a 5, com meia-estrela), uma mensagem curta e descontraída (sem emoji, tom leve em vez de "frase de efeito") e a transcrição do Whisper dividida em linhas (divisão cosmética, feita por pontuação do texto — o Whisper não devolve linhas de verdade). Botões: "Tentar novamente" (reabre o palco na mesma música), "Ver histórico" (vai pro Perfil já preenchido com o nome atual) e "Compartilhar resultado" (usa a API nativa de compartilhamento do navegador, com fallback de copiar texto).

### 7.3 Letra sincronizada (teleprompter)
Como os áudios em `musicas/` são o *instrumental* (sem vocal), não dá pra usar o Whisper pra alinhar a letra automaticamente — não existe voz nenhuma pra transcrever. A sincronização é **manual**:
- Cada música pode ter um `sincronia/{slug}.json` com uma lista de `{ "tempo": <segundos>, "texto": "<linha>" }`.
- O `app.js` busca esse arquivo ao abrir o palco e destaca a linha certa conforme o `currentTime` do player, rolando automaticamente pra ela ficar sempre visível.
- Música sem esse arquivo simplesmente não mostra letra sincronizada (sem erro).
- Existe uma ferramenta separada (fora do repositório, publicada como artifact) pra gerar esse JSON: sobe o MP3, cola a letra linha por linha, e vai apertando Espaço no momento certo de cada linha enquanto a música toca — no final gera o JSON pronto pra salvar em `sincronia/`.

## 8. Decisões já tomadas (para não esquecer o "porquê")
- **MVP primeiro, CREPE depois:** fluxo completo de texto (Whisper + comparação com a letra) antes de somar afinação.
- **Interface web, não app nativo.**
- **SQLite em vez de MySQL.**
- **Git/GitHub para trabalhar em dupla/grupo** — `singai.db`, `audios/` e `musicas/` entram no Git normalmente; por serem binários, podem dar conflito se duas pessoas mexerem ao mesmo tempo (já aconteceu).
- **Soft delete em vez de apagar música do banco:** trocar uma música no catálogo nunca deve quebrar o histórico de quem já cantou a versão antiga.
- **Nome do usuário capturado antes do palco, não dentro dele:** decisão de UX pra deixar o fluxo de gravação mais enxuto e o nome disponível pro resto da sessão (histórico, ranking, tela de resultado) sem precisar redigitar.
- **Instrumental nunca toca sem ação explícita do usuário:** considerado mais honesto não autoplayar ao abrir o modal; ele começa exatamente junto com o "Gravar", pra cantor e instrumental saírem sincronizados desde o primeiro segundo.
- **Confirmação com prévia antes de processar:** gravação ruim ou errada não devia gastar uma chamada ao Whisper à toa; o usuário decide se usa ou descarta.

## 9. Trabalhando em dupla/grupo com Git/GitHub

Repositório do projeto: `https://github.com/MariaClaraAlvs/singai`

### 9.1 Configuração inicial (uma vez por pessoa/computador)
``` bash
git config --global user.name "Seu Nome"
git config --global user.email "seu-email@exemplo.com"
```

### 9.2 Clonando o projeto
``` bash
git clone https://github.com/MariaClaraAlvs/singai.git
cd singai
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn python-multipart openai-whisper jiwer
```
(o `venv/` não vem no clone, está no `.gitignore` — cada pessoa cria o seu próprio ambiente local)

### 9.3 Autenticação no GitHub
Necessário um **Personal Access Token (PAT)** no lugar da senha (GitHub → Settings → Developer settings → Personal access tokens → Tokens classic → Generate, marcando `repo`). Opcional: `git config --global credential.helper store` pra não digitar toda vez.

### 9.4 Rotina de trabalho
Antes de mexer em qualquer coisa:
``` bash
git pull
```
Depois de terminar uma alteração:
``` bash
git add .
git commit -m "descrição curta do que mudou"
git push
```

### 9.5 Resolvendo conflito em `singai.db`
Como o banco é um arquivo binário versionado, um `git pull` pode recusar sobrescrever mudanças locais não commitadas nele. Se não precisar manter o que só existe localmente:
``` bash
git checkout -- singai.db
git pull
```
Se precisar manter dados locais importantes, é mais seguro combinar com quem fez o outro commit antes de decidir qual versão vence — não dá pra mesclar automaticamente um banco binário.

### 9.6 O que fica de fora do Git (`.gitignore`)
    venv/
    __pycache__/
    *.pyc
    .DS_Store

## 10. Roteiro do que falta (visão geral)
1. Completar a letra/capa que ainda faltar no catálogo.
2. Gerar os arquivos de `sincronia/` pras músicas que ainda não têm letra sincronizada em tempo real.
3. Integrar o CREPE para a pontuação de afinação (evolução final, conforme o relatório).
4. Suporte a performance em duo (desenho de schema com uma tabela de participantes já discutido, mas ainda não implementado) — uníssono/alternado tende a funcionar razoavelmente com o pipeline atual; vozes simultâneas cantando partes diferentes não é confiável sem separação de fonte de áudio, considerada fora de escopo.
5. Avaliar trocar o modelo do Whisper (testar `medium`/`small` como alternativa ao atual, pesando precisão vs. velocidade) e permitir outros idiomas além de português.
6. Diff palavra-a-palavra (certo/errado) na tela de resultado, em vez de só a transcrição corrida — já tem um caminho desenhado (`difflib`), mas não implementado.
