let mediaRecorder;
let audioChunks = [];
let musicaSelecionada = "";
let linhasSincronia = [];

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
    container.innerHTML = "";
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
    el.classList.toggle("linha-ativa", i === indiceAtivo);
  });
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
    player.src = `/musica-audio/${musicaAtual}`;
    player.load();

    player.play().catch((erro) => {
      console.warn("Não foi possível iniciar o áudio automaticamente:", erro);
    });

    carregarSincronia(musicaAtual);
    player.removeEventListener("timeupdate", destacarLinhaAtual);
    player.addEventListener("timeupdate", destacarLinhaAtual);
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

  mediaRecorder.onstop = async () => {
    const nomeUsuario = document.getElementById("nomeUsuario").value.trim() || "Anônimo";
    const audioBlob = new Blob(audioChunks, { type: "audio/wav" });
    musicaSelecionada = document.getElementById("listaMusicas").value;
    const nomeArquivo = `${musicaSelecionada}_${Date.now()}.wav`;

    const formData = new FormData();
    formData.append("audio", audioBlob, nomeArquivo);

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

    carregarHistorico();
  };

  document.getElementById("btnGravar").disabled = false;
  document.getElementById("btnParar").disabled = true;
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
  const campoNome = document.getElementById("perfilNome");
  const container = document.getElementById("perfilResultado");

  if (!campoNome || !container) return;

  const nome = campoNome.value.trim();

  if (!nome) {
    container.innerHTML = '<p class="mensagem-vazia">Digite um nome para ver o perfil.</p>';
    campoNome.focus();
    return;
  }

  container.innerHTML = '<p class="mensagem-vazia">Carregando...</p>';

  try {
    const resposta = await fetch("/historico?limite=100");

    if (!resposta.ok) throw new Error(`Erro HTTP ${resposta.status}`);

    const dados = await resposta.json();

    const historico = (Array.isArray(dados.historico) ? dados.historico : [])
      .filter(item => String(item.usuario || "").toLocaleLowerCase() === nome.toLocaleLowerCase());

    if (!historico.length) {
      container.innerHTML = `<p class="mensagem-vazia">Nenhuma performance encontrada para ${nome}.</p>`;
      return;
    }

    const media = historico.reduce((total, item) => total + Number(item.pontuacao || 0), 0) / historico.length;

    container.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-valor">${historico.length}</div>
          <div class="stat-label">Performances</div>
        </div>
        <div class="stat-card">
          <div class="stat-valor">${media.toFixed(2)}%</div>
          <div class="stat-label">Média de pontuação</div>
        </div>
      </div>

      <div class="perfil-lista-titulo">Histórico de ${nome}</div>

      ${historico.map((item, index) => `
        <div class="historico-item">
          ${capaHTML(item.musica_id || "", String(item.musica_id || "♪").charAt(0).toUpperCase(), index, "historico-capa")}
          <div class="historico-info">
            <div class="historico-nome">${String(item.musica_id || "Música").replace(/_/g, " ")}</div>
            <div class="barra">
              <div class="barra-preenchida" style="width:${Math.max(0, Math.min(100, Number(item.pontuacao || 0)))}%"></div>
            </div>
          </div>
          <div class="score">${item.pontuacao}%</div>
        </div>
      `).join("")}
    `;
  } catch (erro) {
    console.error("Erro ao carregar perfil:", erro);
    container.innerHTML = '<p class="mensagem-vazia">Não foi possível carregar o perfil. Verifique se o backend está ativo.</p>';
  }
}

/* ---------- TELA DE RANKING ---------- */

async function carregarRanking() {
  const container = document.getElementById("rankingLista");

  if (!container) return;

  container.innerHTML = '<p class="mensagem-vazia">Carregando ranking...</p>';

  try {
    const resposta = await fetch("/ranking");

    if (!resposta.ok) throw new Error(`Erro HTTP ${resposta.status}`);

    const dados = await resposta.json();

    const ranking = Array.isArray(dados.ranking) ? dados.ranking :
      Array.isArray(dados.usuarios) ? dados.usuarios :
      Array.isArray(dados) ? dados : [];

    if (!ranking.length) {
      container.innerHTML = '<p class="mensagem-vazia">Ainda não há pontuações no ranking.</p>';
      return;
    }

    container.innerHTML = "";

    ranking.forEach((item, index) => {
      const nome = item.usuario || item.nome || "Anônimo";
      const nota = Number(item.pontuacao ?? item.media ?? item.melhor_pontuacao ?? 0);

      const medalha = index === 0 ? "ouro" :
        index === 1 ? "prata" :
        index === 2 ? "bronze" : "";

      const linha = document.createElement("div");
      linha.className = "ranking-item";

      linha.innerHTML = `
        <div class="ranking-pos ${medalha}">${index + 1}</div>
        <div class="ranking-nome">${nome}</div>
        <div class="ranking-nota">${nota.toFixed(2)}%</div>
      `;

      container.appendChild(linha);
    });

  } catch (erro) {
    console.error("Erro ao carregar ranking:", erro);
    container.innerHTML = '<p class="mensagem-vazia">Não foi possível carregar o ranking.</p>';
  }
}

/* ---------- INICIALIZAÇÃO E EVENTOS ---------- */

function configurarEventos() {
  const telaAbertura = document.getElementById("telaAbertura");
  const botaoComecar = document.getElementById("btnComecarCantar");

  // Evento do botão da tela inicial
  if (botaoComecar && telaAbertura) {
    botaoComecar.addEventListener("click", () => {
      telaAbertura.classList.add("saindo");
    });
  }

  // Navegação lateral
  document.querySelectorAll(".nav-item[data-view]").forEach(item => {
    item.addEventListener("click", () => trocarView(item.dataset.view));
  });

  // Botões principais
  document.getElementById("btnFaixaDestaque")?.addEventListener("click", () => abrirModal());
  document.getElementById("btnAbrirModal")?.addEventListener("click", () => abrirModal());
  document.getElementById("btnAtalhoPerfil")?.addEventListener("click", () => trocarView("perfil"));

  // Perfil
  document.getElementById("btnVerPerfil")?.addEventListener("click", verPerfil);

  document.getElementById("perfilNome")?.addEventListener("keydown", evento => {
    if (evento.key === "Enter") verPerfil();
  });

  // Gravação
  document.getElementById("btnGravar")?.addEventListener("click", iniciarGravacao);
  document.getElementById("btnParar")?.addEventListener("click", pararGravacao);

  // Fechar modal
  document.getElementById("fecharModal")?.addEventListener("click", fecharModal);

  // Seleção de música
  document.getElementById("listaMusicas")?.addEventListener("change", evento => {
    const id = evento.target.value;

    if (!id) return;

    const player = document.getElementById("playerMusica");

    if (player) {
      player.src = `/musica-audio/${encodeURIComponent(id)}`;
      player.load();

      player.play().catch(erro => {
        console.warn("Reprodução automática bloqueada:", erro);
      });
    }

    carregarSincronia(id);
  });

  document.getElementById("playerMusica")?.addEventListener("timeupdate", destacarLinhaAtual);

  // Fechar modal clicando fora
  document.getElementById("modalFundo")?.addEventListener("click", evento => {
    if (evento.target.id === "modalFundo") fecharModal();
  });

  // Busca de músicas
  document.querySelector(".busca input")?.addEventListener("input", evento => {
    const termo = evento.target.value.trim().toLocaleLowerCase();

    document.querySelectorAll("#catalogo .musica-card").forEach(card => {
      card.hidden = !card.textContent.toLocaleLowerCase().includes(termo);
    });
  });
}

// Inicialização
document.addEventListener("DOMContentLoaded", () => {
  configurarEventos();
  carregarMusicas();
  carregarHistorico();
});
