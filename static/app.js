let mediaRecorder;
let audioChunks = [];
let musicaSelecionada = "";
let linhasSincronia = [];
let musicasInfo = {}; // slug -> { titulo, artista }
let blobPendente = null;
let nomeArquivoPendente = "";

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
    `;
    card.addEventListener("click", () => abrirModal(musica.id));
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

  carregarSincronia(musicaId);
}

function abrirModal(musica) {
  document.getElementById("modalFundo").classList.add("aberto");
  if (musica) {
    document.getElementById("listaMusicas").value = musica;
  }
  document.getElementById("resultado").textContent = "Escolha uma música e comece a gravar!";

  const musicaAtual = musica || document.getElementById("listaMusicas").value;
  const player = document.getElementById("playerMusica");
  if (musicaAtual && player) {
    carregarMusicaNoModal(musicaAtual);

    player.play().catch((erro) => {
      console.warn("Não foi possível iniciar o áudio automaticamente:", erro);
    });

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
  document.getElementById("btnGravar").disabled = true;
  document.getElementById("btnParar").disabled = false;
}

function pararGravacao() {
  mediaRecorder.stop();

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

async function confirmarEnvio() {
  if (!blobPendente) return;

  document.getElementById("confirmacaoGravacao").style.display = "none";

  const nomeUsuario = document.getElementById("nomeUsuario").value.trim() || "Anônimo";
  const formData = new FormData();
  formData.append("audio", blobPendente, nomeArquivoPendente);

  document.getElementById("resultado").textContent = "Enviando áudio...";

  const respostaGravar = await fetch("/gravar", {
    method: "POST",
    body: formData,
  });
  const dadosGravar = await respostaGravar.json();

  document.getElementById("resultado").textContent = "Calculando pontuação...";

  const respostaPontuar = await fetch(
    `/pontuar?nome_arquivo=${dadosGravar.arquivo}&musica_id=${musicaSelecionada}&usuario=${encodeURIComponent(nomeUsuario)}`,
    { method: "POST" }
  );
  const resultado = await respostaPontuar.json();

  document.getElementById("resultado").innerHTML = `
    <p><b>Pontuação:</b> ${resultado.pontuacao}</p>
    <p><b>Transcrição:</b> ${resultado.transcricao}</p>
  `;

  blobPendente = null;
  carregarHistorico();
}

function descartarGravacao() {
  blobPendente = null;
  document.getElementById("confirmacaoGravacao").style.display = "none";
  document.getElementById("resultado").textContent = "Escolha uma música e comece a gravar!";
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
    container.innerHTML = `<p class="mensagem-vazia">Nenhuma performance encontrada para "${nome}". Confira se o nome foi digitado do mesmo jeito usado ao gravar.</p>`;
    return;
  }

  const pontuacoes = dados.historico.map((item) => item.pontuacao);
  const total = pontuacoes.length;
  const melhor = Math.max(...pontuacoes);
  const media = (pontuacoes.reduce((soma, p) => soma + p, 0) / total).toFixed(2);

  let html = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-valor">${total}</div>
        <div class="stat-label">Performances</div>
      </div>
      <div class="stat-card">
        <div class="stat-valor">${melhor}%</div>
        <div class="stat-label">Melhor pontuação</div>
      </div>
      <div class="stat-card">
        <div class="stat-valor">${media}%</div>
        <div class="stat-label">Média</div>
      </div>
    </div>
    <div class="perfil-lista-titulo">Histórico de ${nome}</div>
  `;

  dados.historico.forEach((item, index) => {
    html += `
      <div class="historico-item">
        ${capaHTML(item.musica_id, item.musica_id.charAt(0).toUpperCase(), index, "historico-capa")}
        <div class="historico-info">
          <div class="historico-nome">${item.musica_id.replace(/_/g, " ")}</div>
          <div class="barra"><div class="barra-preenchida ${classeCor(index)}" style="width:${item.pontuacao}%"></div></div>
        </div>
        <div class="score">${item.pontuacao}%</div>
      </div>
    `;
  });

  container.innerHTML = html;
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

  const medalhas = ["ouro", "prata", "bronze"];

  container.innerHTML = "";
  dados.ranking.forEach((item, index) => {
    const classeMedalha = medalhas[index] || "";
    const div = document.createElement("div");
    div.className = "ranking-item";
    div.innerHTML = `
      <div class="ranking-pos ${classeMedalha}">${index + 1}</div>
      <div class="ranking-nome">${item.usuario}</div>
      <div class="ranking-nota">${item.melhor_pontuacao}%</div>
    `;
    container.appendChild(div);
  });
}

/* ---------- EVENTOS ---------- */

document.getElementById("btnGravar").addEventListener("click", iniciarGravacao);
document.getElementById("btnParar").addEventListener("click", pararGravacao);
document.getElementById("btnAbrirModal").addEventListener("click", () => abrirModal());
document.getElementById("btnFaixaDestaque").addEventListener("click", () => abrirModal());
document.getElementById("fecharModal").addEventListener("click", fecharModal);
document.getElementById("btnPlayPause").addEventListener("click", alternarPlayPause);
document.getElementById("btnUsarGravacao").addEventListener("click", confirmarEnvio);
document.getElementById("btnDescartarGravacao").addEventListener("click", descartarGravacao);

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
