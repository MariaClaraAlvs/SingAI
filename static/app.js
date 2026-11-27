let mediaRecorder;
let audioChunks = [];
let musicaSelecionada = "";
let linhasSincronia = [];
let musicasInfo = {}; // slug -> { titulo, artista }
let blobPendente = null;
let nomeArquivoPendente = "";
let nomeUsuarioAtual = "";
let musicaPendenteAposNome = null;

function classeCor(index) {
  return `c${index % 5}`;
}

function handleCapaError(img, letra) {
  const capa = img.parentElement;
  capa.innerHTML = letra;
}

function capaHTML(identificador, letra, index, classeBase = "capa") {
  return `
    <div class="${classeBase} ${classeCor(index)}">
      <img src="/static/capas/${identificador}.jpg" alt="${letra}" onerror="handleCapaError(this, '${letra}')">
    </div>
  `;
}

async function carregarMusicas() {
  const resposta = await fetch("/musicas");
  const dados = await resposta.json();

  const catalogo = document.getElementById("catalogo");
  const select = document.getElementById("listaMusicas");

  dados.musicas.forEach((musica, index) => {
    musicasInfo[musica.id] = { titulo: musica.titulo, artista: musica.artista };

    const card = document.createElement("div");
    card.className = "musica-card";
    card.innerHTML = `
      ${capaHTML(musica.id, musica.titulo.charAt(0).toUpperCase(), index)}
      <div class="nome">${musica.titulo}</div>
      ${musica.artista ? `<div class="artista">${musica.artista}</div>` : ""}
    `;
    card.addEventListener("click", () => iniciarFluxoCantar(musica.id));
    catalogo.appendChild(card);

    const opcao = document.createElement("option");
    opcao.value = musica.id;
    opcao.textContent = musica.titulo;
    select.appendChild(opcao);
  });
}

async function carregarHistorico() {
  const resposta = await fetch("/historico?limite=5");
  const dados = await resposta.json();
  const container = document.getElementById("historico");

  if (dados.historico.length === 0) {
    container.innerHTML = `<div class="historico-item"><span class="mensagem-vazia">Nenhuma performance ainda</span></div>`;
    return;
  }

  container.innerHTML = "";
  dados.historico.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = "historico-item";
    div.innerHTML = `
      ${capaHTML(item.musica_id, item.musica_id.charAt(0).toUpperCase(), index, "historico-capa")}
      <div class="historico-info">
        <div class="historico-nome">${item.musica_id.replace(/_/g, " ")}</div>
        <div style="font-size:0.75rem; opacity:0.6;">${item.usuario}</div>
        <div class="barra"><div class="barra-preenchida ${classeCor(index)}" style="width:${item.pontuacao}%"></div></div>
      </div>
      <div class="score">${item.pontuacao}%</div>
    `;
    container.appendChild(div);
  });
}

async function carregarSincronia(musicaId) {
  const container = document.getElementById("letraSincronizada");
  try {
    const resposta = await fetch(`/sincronia/${musicaId}`);
    const dados = await resposta.json();
    linhasSincronia = dados.linhas || [];
  } catch (erro) {
    linhasSincronia = [];
  }

  if (linhasSincronia.length === 0) {
    container.innerHTML = `<p class="mensagem-vazia" style="color:#9FB4E0;">Letra sincronizada ainda não disponível pra essa música.</p>`;
    return;
  }

  container.innerHTML = linhasSincronia
    .map((linha, i) => `<p class="linha-letra" data-index="${i}">${linha.texto}</p>`)
    .join("");
}

function destacarLinhaAtual() {
  const player = document.getElementById("playerMusica");
  if (!linhasSincronia.length || !player) return;

  const tempoAtual = player.currentTime;
  let indiceAtivo = 0;
  for (let i = 0; i < linhasSincronia.length; i++) {
    if (tempoAtual >= linhasSincronia[i].tempo) indiceAtivo = i;
  }

  document.querySelectorAll(".linha-letra").forEach((el, i) => {
    const ativa = i === indiceAtivo;
    el.classList.toggle("linha-ativa", ativa);
    if (ativa) {
      // Rolagem automática: mantém a linha atual sempre visível, sem precisar arrastar
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
}

function formatarTempo(segundos) {
  if (!isFinite(segundos)) return "0:00";
  const min = Math.floor(segundos / 60);
  const seg = Math.floor(segundos % 60).toString().padStart(2, "0");
  return `${min}:${seg}`;
}

function atualizarTempoExibido() {
  const player = document.getElementById("playerMusica");
  document.getElementById("palcoTempo").textContent =
    `${formatarTempo(player.currentTime)} / ${formatarTempo(player.duration)}`;
}

function alternarPlayPause() {
  const player = document.getElementById("playerMusica");
  if (player.paused) {
    player.play().catch(() => {});
  } else {
    player.pause();
  }
}

function sincronizarIconesEDisco() {
  const player = document.getElementById("playerMusica");
  const disco = document.getElementById("discoVinil");
  const tocando = !player.paused && !player.ended;
  document.getElementById("iconePlay").style.display = tocando ? "none" : "block";
  document.getElementById("iconePause").style.display = tocando ? "block" : "none";
  disco.classList.toggle("tocando", tocando);
}

function carregarMusicaNoModal(musicaId) {
  const info = musicasInfo[musicaId] || {};
  const letraInicial = (info.titulo || musicaId).charAt(0).toUpperCase();

  document.getElementById("musicaTitulo").textContent = info.titulo || musicaId;
  document.getElementById("musicaArtista").textContent = info.artista || "";

  const capaImg = document.getElementById("musicaCapa");
  const capaContainer = document.getElementById("musicaCapaContainer");
  capaContainer.dataset.letraFallback = letraInicial;
  capaContainer.innerHTML = `<img id="musicaCapa" src="/static/capas/${musicaId}.jpg" alt="${letraInicial}" onerror="handleCapaError(this, '${letraInicial}')">`;

  const player = document.getElementById("playerMusica");
  player.src = `/musica-audio/${musicaId}`;
  player.load();
  // Não toca automaticamente — o usuário decide quando começar, pelo botão de play.
  sincronizarIconesEDisco();

  carregarSincronia(musicaId);
}

function iniciarFluxoCantar(musicaId) {
  if (nomeUsuarioAtual) {
    abrirModal(musicaId);
    return;
  }
  musicaPendenteAposNome = musicaId || null;
  const campo = document.getElementById("campoNomeEntrada");
  campo.value = "";
  document.getElementById("modalNomeFundo").classList.add("aberto");
  campo.focus();
}

function confirmarNomeEAbrirPalco() {
  const campo = document.getElementById("campoNomeEntrada");
  const nome = campo.value.trim();
  if (!nome) {
    campo.focus();
    return;
  }
  nomeUsuarioAtual = nome;
  document.getElementById("modalNomeFundo").classList.remove("aberto");
  abrirModal(musicaPendenteAposNome);
}

function trocarNome() {
  musicaPendenteAposNome = document.getElementById("listaMusicas").value || musicaSelecionada;
  const campo = document.getElementById("campoNomeEntrada");
  campo.value = nomeUsuarioAtual;
  document.getElementById("modalNomeFundo").classList.add("aberto");
  campo.focus();
  campo.select();
}

function abrirModal(musica) {
  document.getElementById("modalFundo").classList.add("aberto");
  if (musica) {
    document.getElementById("listaMusicas").value = musica;
  }
  document.getElementById("resultado").textContent = "";
  document.getElementById("palcoCantorNome").textContent = nomeUsuarioAtual;

  const musicaAtual = musica || document.getElementById("listaMusicas").value;
  const player = document.getElementById("playerMusica");
  if (musicaAtual && player) {
    carregarMusicaNoModal(musicaAtual);

    player.removeEventListener("loadedmetadata", atualizarTempoExibido);
    player.addEventListener("loadedmetadata", atualizarTempoExibido);
    player.removeEventListener("timeupdate", destacarLinhaAtual);
    player.addEventListener("timeupdate", destacarLinhaAtual);
    player.removeEventListener("timeupdate", atualizarTempoExibido);
    player.addEventListener("timeupdate", atualizarTempoExibido);
    player.removeEventListener("play", sincronizarIconesEDisco);
    player.addEventListener("play", sincronizarIconesEDisco);
    player.removeEventListener("pause", sincronizarIconesEDisco);
    player.addEventListener("pause", sincronizarIconesEDisco);
    player.removeEventListener("ended", sincronizarIconesEDisco);
    player.addEventListener("ended", sincronizarIconesEDisco);
  }
}

function fecharModal() {
  document.getElementById("modalFundo").classList.remove("aberto");

  const player = document.getElementById("playerMusica");
  if (player) {
    player.pause();
    player.currentTime = 0;
  }
}

async function iniciarGravacao() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  audioChunks = [];

  mediaRecorder.ondataavailable = (evento) => {
    audioChunks.push(evento.data);
  };
  mediaRecorder.start();

  const player = document.getElementById("playerMusica");
  player.currentTime = 0;
  player.play().catch((erro) => {
    console.warn("Não foi possível iniciar o instrumental junto com a gravação:", erro);
  });

  document.getElementById("btnGravar").disabled = true;
  document.getElementById("btnParar").disabled = false;
}

function pararGravacao() {
  mediaRecorder.stop();
  document.getElementById("playerMusica").pause();

  mediaRecorder.onstop = () => {
    blobPendente = new Blob(audioChunks, { type: "audio/wav" });
    musicaSelecionada = document.getElementById("listaMusicas").value;
    nomeArquivoPendente = `${musicaSelecionada}_${Date.now()}.wav`;

    const preview = document.getElementById("previewGravacao");
    preview.src = URL.createObjectURL(blobPendente);

    document.getElementById("confirmacaoGravacao").style.display = "block";
    document.getElementById("resultado").textContent = "Ouça a prévia acima antes de enviar.";

    document.getElementById("btnGravar").disabled = false;
    document.getElementById("btnParar").disabled = true;
  };
}

function definirFeedback(pontuacao) {
  if (pontuacao >= 90) {
    return { titulo: "Mandou bem", mensagem: "Essa veio redondinha.", rodapeTitulo: "Modo karaokê desbloqueado", rodapeTexto: "Bora ver se repete essa façanha?" };
  }
  if (pontuacao >= 70) {
    return { titulo: "Boa!", mensagem: "Deu pra sentir o embalo.", rodapeTitulo: "Quase no talo", rodapeTexto: "Mais uma tentativa e isso estoura 90%." };
  }
  if (pontuacao >= 50) {
    return { titulo: "Deu pra ouvir", mensagem: "Teve uns tropeços no meio do caminho.", rodapeTitulo: "Treino em andamento", rodapeTexto: "Tenta de novo acompanhando a letra na tela." };
  }
  return { titulo: "Começou", mensagem: "O Whisper se perdeu em alguns trechos aqui.", rodapeTitulo: "Bola pra frente", rodapeTexto: "Grava de novo quando quiser, sem pressa." };
}

function estrelasHTML(pontuacao) {
  const notaEm5 = Math.max(0, Math.min(5, pontuacao / 20));
  let html = "";
  for (let i = 0; i < 5; i++) {
    const fracao = Math.max(0, Math.min(1, notaEm5 - i));
    const percentual = Math.round(fracao * 100);
    html += `
      <span class="estrela">
        <span class="estrela-base">★</span>
        <span class="estrela-preenchida" style="width:${percentual}%">★</span>
      </span>
    `;
  }
  return html;
}

function quebrarEmLinhas(texto) {
  // o Whisper devolve texto corrido; separamos em frases curtas só pra exibição
  const partes = texto.split(/(?<=[.,!?])\s+/).map((p) => p.trim()).filter((p) => p.length > 0);
  return partes.length > 0 ? partes : [texto];
}

function exibirTelaResultado(resultado) {
  const info = musicasInfo[musicaSelecionada] || {};
  const letraInicial = (info.titulo || musicaSelecionada).charAt(0).toUpperCase();

  const capaContainer = document.getElementById("resultadoCapaContainer");
  capaContainer.innerHTML = `<img src="/static/capas/${musicaSelecionada}.jpg" alt="${letraInicial}" onerror="handleCapaError(this, '${letraInicial}')">`;
  document.getElementById("resultadoMusicaTitulo").textContent = info.titulo || musicaSelecionada;
  document.getElementById("resultadoMusicaArtista").textContent = info.artista || "";

  const feedback = definirFeedback(resultado.pontuacao);
  document.getElementById("resultadoTitulo").textContent = feedback.titulo;
  document.getElementById("resultadoMensagem").textContent = feedback.mensagem;
  document.getElementById("resultadoRodapeTexto").textContent = feedback.rodapeTexto;
  document.querySelector(".resultado-rodape-titulo").textContent = feedback.rodapeTitulo;

  document.getElementById("resultadoPorcentagem").textContent = `${resultado.pontuacao}%`;
  document.getElementById("resultadoEstrelas").innerHTML = estrelasHTML(resultado.pontuacao);

  const linhas = quebrarEmLinhas(resultado.transcricao);
  document.getElementById("resultadoTranscricao").innerHTML = linhas
    .map((linha, i) => `<p class="linha-transcricao ${i === 0 ? "linha-transcricao-ativa" : ""}">${linha}</p>`)
    .join("");

  fecharModal();
  trocarView("resultado");
}

async function compartilharResultado() {
  const titulo = document.getElementById("resultadoMusicaTitulo").textContent;
  const porcentagem = document.getElementById("resultadoPorcentagem").textContent;
  const texto = `Cantei "${titulo}" e tirei ${porcentagem} no SingAI!`;

  if (navigator.share) {
    try {
      await navigator.share({ text: texto });
      return;
    } catch (erro) {
      // usuário cancelou o compartilhamento, sem problema
      return;
    }
  }

  try {
    await navigator.clipboard.writeText(texto);
    alert("Resultado copiado! Cole onde quiser compartilhar.");
  } catch (erro) {
    alert(texto);
  }
}

/* ---------- TELA DE PROCESSAMENTO ---------- */

let progressoExibido = 0;

function novoIdDeTarefa() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mostrarProgresso(percentual, etapa) {
  const rotulo = document.getElementById("processandoPorcentagem");
  const barra = document.getElementById("processandoBarra");

  if (etapa) document.getElementById("processandoEtapa").textContent = etapa;

  if (percentual === null || percentual === undefined) {
    // o servidor ainda não informou o progresso: barra indeterminada, sem número inventado
    barra.classList.add("indeterminada");
    barra.style.width = "";
    rotulo.textContent = "…";
    return;
  }

  barra.classList.remove("indeterminada");
  progressoExibido = Math.max(progressoExibido, Math.min(100, percentual)); // nunca volta atrás
  barra.style.width = `${progressoExibido}%`;
  rotulo.textContent = `${Math.round(progressoExibido)}%`;
}

function abrirTelaProcessamento() {
  const info = musicasInfo[musicaSelecionada] || {};
  const letraInicial = (info.titulo || musicaSelecionada).charAt(0).toUpperCase();

  document.getElementById("processandoCapaContainer").innerHTML =
    `<img src="/static/capas/${musicaSelecionada}.jpg" alt="${letraInicial}" onerror="handleCapaError(this, '${letraInicial}')">`;
  document.getElementById("processandoMusicaTitulo").textContent = info.titulo || musicaSelecionada;
  document.getElementById("processandoMusicaArtista").textContent = info.artista || "";

  document.getElementById("processandoTitulo").textContent = "Analisando sua performance";
  document.getElementById("processandoErro").style.display = "none";
  progressoExibido = 0;
  mostrarProgresso(0, "Enviando áudio...");

  fecharModal();
  trocarView("processando");
}

function mostrarErroProcessamento(mensagem) {
  document.getElementById("processandoTitulo").textContent = "Não deu certo";
  document.getElementById("processandoEtapa").textContent = "";
  document.getElementById("processandoErroTexto").textContent = mensagem;
  document.getElementById("processandoErro").style.display = "block";
  document.getElementById("processandoBarra").classList.remove("indeterminada");
}

function acompanharProgresso(idTarefa) {
  let ativo = true;

  async function consultar() {
    if (!ativo) return;
    try {
      const resposta = await fetch(`/progresso/${encodeURIComponent(idTarefa)}`);
      if (resposta.ok) {
        const dados = await resposta.json();
        if (ativo && typeof dados.percentual === "number") {
          mostrarProgresso(dados.percentual, dados.etapa);
        }
      }
    } catch (erro) {
      // sem resposta agora; tenta de novo no próximo ciclo
    }
    if (ativo) setTimeout(consultar, 500);
  }

  consultar();
  return () => { ativo = false; };
}

async function confirmarEnvio() {
  if (!blobPendente) return;

  document.getElementById("playerMusica").pause();
  document.getElementById("previewGravacao").pause();
  document.getElementById("confirmacaoGravacao").style.display = "none";
  document.getElementById("resultado").textContent = "";

  const nomeUsuario = nomeUsuarioAtual || "Anônimo";
  const idTarefa = novoIdDeTarefa();
  const formData = new FormData();
  formData.append("audio", blobPendente, nomeArquivoPendente);

  abrirTelaProcessamento();
  let pararAcompanhamento = null;

  try {
    const respostaGravar = await fetch("/gravar", {
      method: "POST",
      body: formData,
    });
    if (!respostaGravar.ok) throw new Error("Falha ao enviar o áudio.");
    const dadosGravar = await respostaGravar.json();

    mostrarProgresso(null, "Calculando pontuação...");
    pararAcompanhamento = acompanharProgresso(idTarefa);

    const respostaPontuar = await fetch(
      `/pontuar?nome_arquivo=${dadosGravar.arquivo}&musica_id=${musicaSelecionada}&usuario=${encodeURIComponent(nomeUsuario)}&id_tarefa=${encodeURIComponent(idTarefa)}`,
      { method: "POST" }
    );
    if (!respostaPontuar.ok) throw new Error("Falha ao calcular a pontuação.");
    const resultado = await respostaPontuar.json();
    if (resultado.erro) throw new Error(resultado.erro);

    pararAcompanhamento();
    pararAcompanhamento = null;
    mostrarProgresso(100, "Pronto!");
    await new Promise((resolver) => setTimeout(resolver, 500));

    blobPendente = null;
    carregarHistorico();
    exibirTelaResultado(resultado);
  } catch (erro) {
    if (pararAcompanhamento) pararAcompanhamento();
    mostrarErroProcessamento(erro.message || "Algo deu errado. Tente gravar novamente.");
  }
}

function descartarGravacao() {
  document.getElementById("playerMusica").pause();
  document.getElementById("previewGravacao").pause();
  blobPendente = null;
  document.getElementById("confirmacaoGravacao").style.display = "none";
  document.getElementById("resultado").textContent = "";
}

/* ---------- NAVEGAÇÃO ENTRE TELAS ---------- */

function trocarView(nomeView) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("view-ativa", view.id === `view-${nomeView}`);
  });

  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    item.classList.toggle("ativo", item.dataset.view === nomeView);
  });

  if (nomeView === "ranking") {
    carregarRanking();
  }
}

/* ---------- TELA DE PERFIL ---------- */

function escaparHTML(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function tituloMusica(musicaId) {
  const info = musicasInfo[musicaId];
  return info && info.titulo ? info.titulo : musicaId.replace(/_/g, " ");
}

function lerData(texto) {
  if (!texto) return null;
  const data = new Date(String(texto).replace(" ", "T"));
  return isNaN(data.getTime()) ? null : data;
}

function nivelDoCantor(melhor) {
  if (melhor >= 90) return "Lenda do karaokê";
  if (melhor >= 70) return "Estrela";
  if (melhor >= 50) return "Promessa";
  return "Iniciante";
}

function classeNota(pontuacao) {
  if (pontuacao >= 70) return "nota-alta";
  if (pontuacao >= 50) return "nota-media";
  return "nota-baixa";
}

const ICONE_ESTRELA = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>`;

async function verPerfil() {
  const nome = document.getElementById("perfilNome").value.trim();
  const container = document.getElementById("perfilResultado");

  if (!nome) {
    container.innerHTML = `<p class="mensagem-vazia">Digite um nome para ver o perfil.</p>`;
    return;
  }

  container.innerHTML = `<p class="mensagem-vazia">Carregando...</p>`;

  const resposta = await fetch(`/historico?usuario=${encodeURIComponent(nome)}&limite=100`);
  const dados = await resposta.json();

  if (dados.historico.length === 0) {
    container.innerHTML = `<p class="mensagem-vazia">Nenhuma performance encontrada para "${escaparHTML(nome)}". Confira se o nome foi digitado do mesmo jeito usado ao gravar.</p>`;
    return;
  }

  // Posição no ranking (opcional: se a consulta falhar, o perfil aparece sem ela)
  let posicaoRanking = null;
  try {
    const respostaRanking = await fetch("/ranking?limite=100");
    const dadosRanking = await respostaRanking.json();
    const indice = dadosRanking.ranking.findIndex((r) => r.usuario.toLowerCase() === nome.toLowerCase());
    if (indice >= 0) posicaoRanking = indice + 1;
  } catch (erro) {
    posicaoRanking = null;
  }

  const historico = dados.historico;
  const pontuacoes = historico.map((item) => item.pontuacao);
  const total = pontuacoes.length;
  const melhor = Math.max(...pontuacoes);
  const indiceMelhor = pontuacoes.indexOf(melhor);
  const media = (pontuacoes.reduce((soma, p) => soma + p, 0) / total).toFixed(2);
  const musicasDiferentes = new Set(historico.map((item) => item.musica_id)).size;

  // Ordem cronológica (da mais antiga para a mais recente) para o gráfico de evolução
  const todasComData = historico.every((item) => lerData(item.data));
  const cronologico = todasComData
    ? [...historico].sort((a, b) => lerData(a.data) - lerData(b.data))
    : [...historico].reverse();

  const primeiraData = todasComData ? lerData(cronologico[0].data) : null;
  const desde = primeiraData ? `Cantando desde ${primeiraData.toLocaleDateString("pt-BR")}` : `${total} ${total === 1 ? "performance" : "performances"} registradas`;

  // Evolução: até as 10 performances mais recentes
  const recentes = cronologico.slice(-10);
  const indiceMelhorRecente = recentes.reduce((m, item, i) => (item.pontuacao > recentes[m].pontuacao ? i : m), 0);
  const barrasHTML = recentes
    .map((item, i) => {
      const data = lerData(item.data);
      const rotulo = data ? data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : `#${i + 1}`;
      return `
        <div class="evolucao-coluna" title="${escaparHTML(tituloMusica(item.musica_id))}">
          <div class="evolucao-valor">${Math.round(item.pontuacao)}%</div>
          <div class="evolucao-trilho">
            <div class="evolucao-barra ${i === indiceMelhorRecente ? "recorde" : ""}" style="height:${Math.max(3, item.pontuacao)}%"></div>
          </div>
          <div class="evolucao-rotulo">${rotulo}</div>
        </div>`;
    })
    .join("");

  // Conquistas calculadas a partir do histórico (nada novo no banco)
  const conquistas = [
    { nome: "Estreou no palco", dica: "Fez a 1ª performance", ok: total >= 1 },
    { nome: "Pegando o ritmo", dica: "5 performances", ok: total >= 5 },
    { nome: "Eclético", dica: "3 músicas diferentes", ok: musicasDiferentes >= 3 },
    { nome: "Promessa", dica: "Chegou a 50%", ok: melhor >= 50 },
    { nome: "Estrela", dica: "Chegou a 70%", ok: melhor >= 70 },
    { nome: "Redondinho", dica: "Chegou a 90%", ok: melhor >= 90 },
  ];
  const conquistasHTML = conquistas
    .map(
      (c) => `
      <div class="conquista ${c.ok ? "conquistada" : ""}">
        <div class="conquista-icone">${ICONE_ESTRELA}</div>
        <div>
          <div class="conquista-nome">${c.nome}</div>
          <div class="conquista-dica">${c.dica}</div>
        </div>
      </div>`
    )
    .join("");

  const listaHTML = historico
    .map((item, index) => {
      const data = lerData(item.data);
      const info = musicasInfo[item.musica_id] || {};
      const letra = tituloMusica(item.musica_id).charAt(0).toUpperCase();
      return `
      <div class="perfil-hist-item">
        ${capaHTML(item.musica_id, escaparHTML(letra), index, "perfil-capa")}
        <div class="perfil-hist-info">
          <div class="perfil-hist-nome">
            ${escaparHTML(tituloMusica(item.musica_id))}
            ${index === indiceMelhor ? `<span class="perfil-tag-recorde">Recorde</span>` : ""}
          </div>
          <div class="perfil-hist-sub">${escaparHTML([info.artista, data ? data.toLocaleDateString("pt-BR") : ""].filter(Boolean).join(" · "))}</div>
          <div class="perfil-barra"><div class="perfil-barra-preenchida" style="width:${item.pontuacao}%"></div></div>
        </div>
        <div class="perfil-nota ${classeNota(item.pontuacao)}">${item.pontuacao}%</div>
      </div>`;
    })
    .join("");

  container.innerHTML = `
    <div class="perfil-hero">
      <div class="perfil-avatar">${escaparHTML(nome.charAt(0).toUpperCase())}</div>
      <div class="perfil-hero-info">
        <div class="perfil-hero-nome">${escaparHTML(nome)}</div>
        <div class="perfil-hero-sub">${desde}</div>
      </div>
      <div class="perfil-selos">
        <span class="perfil-selo perfil-selo-nivel">${nivelDoCantor(melhor)}</span>
        ${posicaoRanking ? `<span class="perfil-selo">#${posicaoRanking} no ranking</span>` : ""}
      </div>
    </div>

    <div class="perfil-stats">
      <div class="perfil-stat">
        <div class="perfil-stat-valor">${total}</div>
        <div class="perfil-stat-label">Performances</div>
      </div>
      <div class="perfil-stat">
        <div class="perfil-stat-valor">${melhor}%</div>
        <div class="perfil-stat-label">Melhor pontuação</div>
        <div class="perfil-stat-sub">${escaparHTML(tituloMusica(historico[indiceMelhor].musica_id))}</div>
      </div>
      <div class="perfil-stat">
        <div class="perfil-stat-valor">${media}%</div>
        <div class="perfil-stat-label">Média</div>
      </div>
      <div class="perfil-stat">
        <div class="perfil-stat-valor">${musicasDiferentes}</div>
        <div class="perfil-stat-label">${musicasDiferentes === 1 ? "Música diferente" : "Músicas diferentes"}</div>
      </div>
    </div>

    <div class="perfil-grid">
      <div class="perfil-card">
        <div class="perfil-card-titulo">Evolução</div>
        <div class="evolucao">${barrasHTML}</div>
      </div>
      <div class="perfil-card">
        <div class="perfil-card-titulo">Conquistas</div>
        <div class="conquistas">${conquistasHTML}</div>
      </div>
    </div>

    <div class="perfil-lista-titulo">Histórico de ${escaparHTML(nome)}</div>
    <div class="perfil-hist">${listaHTML}</div>
  `;
}

/* ---------- TELA DE RANKING ---------- */

async function carregarRanking() {
  const container = document.getElementById("rankingLista");
  container.innerHTML = `<p class="mensagem-vazia">Carregando...</p>`;

  const resposta = await fetch("/ranking?limite=10");
  const dados = await resposta.json();

  if (dados.ranking.length === 0) {
    container.innerHTML = `<p class="mensagem-vazia">Ainda não há performances registradas.</p>`;
    return;
  }

  const escapar = escaparHTML;

  const coroaSVG = `<svg class="podio-coroa" width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7z"/></svg>`;

  const montarLugar = (item, posicao) => `
    <div class="podio-lugar podio-${posicao}">
      ${posicao === 1 ? coroaSVG : ""}
      <div class="podio-avatar">${escapar(item.usuario.charAt(0).toUpperCase())}</div>
      <div class="podio-nome">${escapar(item.usuario)}</div>
      <div class="podio-nota">${item.melhor_pontuacao}%</div>
      <div class="podio-degrau"><span>${posicao}</span></div>
    </div>`;

  const ranking = dados.ranking;
  // ordem visual do pódio: 2º à esquerda, 1º no centro, 3º à direita
  const ordemPodio = [1, 0, 2].filter((i) => ranking[i]);

  let html = `<div class="podio">${ordemPodio.map((i) => montarLugar(ranking[i], i + 1)).join("")}</div>`;

  if (ranking.length > 3) {
    html += `<div class="ranking-demais"><div class="ranking-subtitulo">Demais posições</div>`;
    ranking.slice(3).forEach((item, i) => {
      html += `
        <div class="ranking-item">
          <div class="ranking-pos">${i + 4}</div>
          <div class="ranking-nome">${escapar(item.usuario)}</div>
          <div class="ranking-nota">${item.melhor_pontuacao}%</div>
        </div>`;
    });
    html += `</div>`;
  }

  container.innerHTML = html;
}

/* ---------- EVENTOS ---------- */

document.getElementById("btnGravar").addEventListener("click", iniciarGravacao);
document.getElementById("btnParar").addEventListener("click", pararGravacao);
document.getElementById("btnAbrirModal").addEventListener("click", () => iniciarFluxoCantar());
document.getElementById("btnFaixaDestaque").addEventListener("click", () => iniciarFluxoCantar());
document.getElementById("btnConfirmarNome").addEventListener("click", confirmarNomeEAbrirPalco);
document.getElementById("campoNomeEntrada").addEventListener("keydown", (evento) => {
  if (evento.key === "Enter") confirmarNomeEAbrirPalco();
});
document.getElementById("btnTrocarNome").addEventListener("click", trocarNome);
document.getElementById("fecharModal").addEventListener("click", fecharModal);
document.getElementById("btnPlayPause").addEventListener("click", alternarPlayPause);
document.getElementById("btnUsarGravacao").addEventListener("click", confirmarEnvio);
document.getElementById("btnDescartarGravacao").addEventListener("click", descartarGravacao);

document.getElementById("btnVoltarInicio").addEventListener("click", () => trocarView("home"));
document.getElementById("btnProcessandoVoltar").addEventListener("click", () => trocarView("home"));
document.getElementById("btnResultadoTentarNovamente").addEventListener("click", () => {
  trocarView("home");
  abrirModal(musicaSelecionada);
});
document.getElementById("btnResultadoVerHistorico").addEventListener("click", () => {
  trocarView("perfil");
  if (nomeUsuarioAtual) {
    document.getElementById("perfilNome").value = nomeUsuarioAtual;
    verPerfil();
  }
});
document.getElementById("btnResultadoCompartilhar").addEventListener("click", compartilharResultado);

document.getElementById("listaMusicas").addEventListener("change", (evento) => {
  if (evento.target.value) carregarMusicaNoModal(evento.target.value);
});

document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
  item.addEventListener("click", () => trocarView(item.dataset.view));
});

document.getElementById("btnAtalhoPerfil").addEventListener("click", () => trocarView("perfil"));
document.getElementById("btnVerPerfil").addEventListener("click", verPerfil);
document.getElementById("perfilNome").addEventListener("keydown", (evento) => {
  if (evento.key === "Enter") verPerfil();
});

document.getElementById("btnComecarCantar").addEventListener("click", () => {
  document.getElementById("telaAbertura").classList.add("saindo");
});

carregarMusicas();
carregarHistorico();
