async function carregarVagas(){
  const res = await fetch('/api/vagas');
  const vagas = await res.json();
  const vagasDiv = document.getElementById('vagas');
  vagasDiv.innerHTML = '';
  vagas.forEach(v => {
    const el = document.createElement('div');
    el.className = 'vaga';
    el.innerHTML = `<h3>${v.titulo}</h3><p><b>${v.empresa}</b> - ${v.cidade}</p><p>${v.descricao}</p>`;
    vagasDiv.appendChild(el);
  });
}
carregarVagas();