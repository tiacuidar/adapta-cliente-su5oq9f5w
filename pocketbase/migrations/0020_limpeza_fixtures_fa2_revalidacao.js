// FAROL-1 (FA-2) — Limpeza das fixtures da revalidação do fechamento (padrão AP-1258:
// parâmetro app no up; contagem revalidada após aplicar).
// Remove as 2 avaliações criadas pela revalidação:
//   ekkoy6kx9nuqvs3 (pecaf, unidade 2, 2026)
//   evjz8z4tf4w87r4 (pedhe, unidade 101, 2026)
// IDs conferidos 1 a 1; só remove se observacao marca "fixture de prova FA-2 revalidacao".
migrate(
  (app) => {
    const ids = ['ekkoy6kx9nuqvs3', 'evjz8z4tf4w87r4']
    for (const id of ids) {
      try {
        const rec = app.findRecordById('avaliacoes', id)
        const obs = rec.getString('observacao') || ''
        if (obs.indexOf('fixture de prova FA-2') !== -1) {
          app.delete(rec)
        }
      } catch (err) {
        // já inexistente — segue
      }
    }
  },
  (app) => {
    // Down: não recria fixtures de prova
  },
)
