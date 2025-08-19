document.getElementById('form-vaga').addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  await fetch('/api/vagas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  alert('Vaga publicada!');
  e.target.reset();
});