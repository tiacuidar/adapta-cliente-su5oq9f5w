// FAROL-1 (FA-1) — Limpeza das fixtures da prova (2ª tentativa)
// A migration 0015 não removeu os registros: usou $app em vez do parâmetro 'app' do up()
// (inconsistência com o padrão das migrations 0010/0011/0013). Migration aplicada não
// reexecuta — esta 0016 faz a limpeza com o parâmetro correto.
// Remove os 3 registros de unidades_info criados pelas provas da FA-1 (IDs conferidos 1 a 1;
// só remove se observacao marca "fixture de prova FA-1").
migrate(
  (app) => {
    const ids = ['2dw6ae5lzf4vic3', '86stlq433735ywp', 'n2te9ur7pxes7bv']
    for (const id of ids) {
      try {
        const rec = app.findRecordById('unidades_info', id)
        const obs = rec.getString('observacao') || ''
        if (obs.indexOf('fixture de prova FA-1') !== -1) {
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
