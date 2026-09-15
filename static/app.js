let mediaRecorder;
let audioChunks = [];
let musicaSelecionada = "";

// Cicla entre 5 classes de gradiente (definidas no CSS: .capa.c0 até .capa.c4)
function classeCor(index) {
  return `c${index % 5}`;
}

// Carrega o catálogo de músicas e monta os cards + o select do modal
async function carregarMusicas() {
  const resposta = await fetch("/musicas");
  const dados = await resposta.json();

  const catalogo = document.getElementById("catalogo");
  const select = document.getElementById("listaMusicas");

  dados.musicas.forEach((musica, index) => {
    // Card no catálogo
    const card = document.createElement("div");
    card.className = "musica-card";
    card.innerHTML = `
      <div class="capa ${classeCor(index)}">${musica.charAt(0).toUpperCase()}</div>
      <div class="nome">${musica.replace(/_/g, " ")}</div>
    `;
    card.addEventListener("click", () => abrirModal(musica));
    catalogo.appendChild(card);

    // Opção no select do modal
    const opcao = document.createElement("option");
    opcao.value = musica;
    opcao.textContent = musica.replace(/_/g, " ");
    select.appendChild(opcao);
  });
}

// Abre o modal, já selecionando a música clicada (se veio de um card)
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

// Inicia a gravação
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

// Para a gravação e envia pro backend
function pararGravacao() {
  mediaRecorder.stop();

  mediaRecorder.onstop = async () => {
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
      `/pontuar?nome_arquivo=${dadosGravar.arquivo}&musica_id=${musicaSelecionada}`,
      { method: "POST" }
    );
    const resultado = await respostaPontuar.json();

    document.getElementById("resultado").innerHTML = `
      <p><b>Pontuação:</b> ${resultado.pontuacao}</p>
      <p><b>Transcrição:</b> ${resultado.transcricao}</p>
    `;
  };

  document.getElementById("btnGravar").disabled = false;
  document.getElementById("btnParar").disabled = true;
}

document.getElementById("btnGravar").addEventListener("click", iniciarGravacao);
document.getElementById("btnParar").addEventListener("click", pararGravacao);
document.getElementById("btnAbrirModal").addEventListener("click", () => abrirModal());
document.getElementById("fecharModal").addEventListener("click", fecharModal);

carregarMusicas();
