let mediaRecorder;
let audioChunks = [];
let musicaSelecionada = "";

function classeCor(index) {
  return `c${index % 5}`;
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
      <div class="capa ${classeCor(index)}">${musica.charAt(0).toUpperCase()}</div>
      <div class="nome">${musica.replace(/_/g, " ")}</div>
    `;
    card.addEventListener("click", () => abrirModal(musica));
    catalogo.appendChild(card);

    const opcao = document.createElement("option");
    opcao.value = musica;
    opcao.textContent = musica.replace(/_/g, " ");
    select.appendChild(opcao);
  });
}


async function carregarHistorico() {
  const resposta = await fetch("/historico?limite=5");
  const dados = await resposta.json();
  const container = document.getElementById("historico");

  if (dados.historico.length === 0) {
    container.innerHTML = `<div class="historico-item"><span style="opacity:0.5; font-size:0.85rem;">Nenhuma performance ainda</span></div>`;
    return;
  }

  container.innerHTML = "";
  dados.historico.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = "historico-item";
    div.innerHTML = `
      <div class="historico-capa ${classeCor(index)}">${item.musica_id.charAt(0).toUpperCase()}</div>
      <div class="historico-info">
        <div class="historico-nome">${item.musica_id.replace(/_/g, " ")}</div>
        <div style="font-size:0.75rem; opacity:0.6;">${item.usuario}</div>
        <div class="barra"><div class="barra-preenchida ${classeCor(index)}" style="width:${item.pontuacao}%;"></div></div>
      </div>
      <div class="score">${item.pontuacao}%</div>
    `;
    container.appendChild(div);
  });
}

function abrirModal(musica) {
  document.getElementById("modalFundo").classList.add("aberto");
  if (musica) {
    document.getElementById("listaMusicas").value = musica;
  }
  document.getElementById("resultado").textContent = "Escolha uma música e comece a gravar!";
}

function fecharModal() {
  document.getElementById("modalFundo").classList.remove("aberto");
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

document.getElementById("btnGravar").addEventListener("click", iniciarGravacao);
document.getElementById("btnParar").addEventListener("click", pararGravacao);
document.getElementById("btnAbrirModal").addEventListener("click", () => abrirModal());
document.getElementById("fecharModal").addEventListener("click", fecharModal);

carregarMusicas();
carregarHistorico();
