// FAROL-1 (FA-2) — Limpeza das fixtures da prova (padrão AP-2026-10-06-1258:
// parâmetro app no up; revalidar contagem após aplicar).
// Remove as 2 avaliações criadas pelas provas da FA-2:
//   e6ycnz804jphcnd (pecaf, unidade 2, 2026 — prova da soma 80)
//   woc948p88fcoo59 (pedhe, unidade 101, 2026 — prova do PEDHE 18 perguntas)
// IDs conferidos 1 a 1; só remove se observacao marca "fixture de prova FA-2".
migrate(
  (app) => {
    const ids = ['e6ycnz804jphcnd', 'woc948p88fcoo59']
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
