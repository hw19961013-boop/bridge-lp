/* BRIDGE subpage shared JS — v1.0 */
const io = new IntersectionObserver(es => {
  es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('vis'); io.unobserve(e.target); } });
}, { threshold: 0.12 });
document.querySelectorAll('[data-reveal]').forEach(el => io.observe(el));

const nav = document.getElementById('nav');
const prog = document.getElementById('prog');
window.addEventListener('scroll', () => {
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 40);
  if (prog) {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    prog.style.width = (window.scrollY / h * 100) + '%';
  }
});
