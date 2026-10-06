// FAROL-1 (FA-1) — Limpeza das fixtures da prova (padrão das migrations 0010/0011/0013:
// migration aplicada não reexecuta; limpeza de fixture exige migration NOVA).
// Remove os 3 registros de unidades_info criados pelas provas da FA-1:
//   2dw6ae5lzf4vic3 (unidade 2 acuidar — prova em_dia/ativa)
//   86stlq433735ywp (unidade 3 acuidar — prova nao_retorna/suspensa)
//   n2te9ur7pxes7bv (unidade 101 donahelp — prova gestor cria)
// IDs conferidos 1 a 1 antes da exclusão (banco final: 0 registros em unidades_info —
// o cadastro real de status/tentativas fica com o champion pela tela/gestão).
migrate(
  (app) => {
    const ids = ['2dw6ae5lzf4vic3', '86stlq433735ywp', 'n2te9ur7pxes7bv']
    let removidos = 0
    for (const id of ids) {
      try {
        const rec = $app.findRecordById('unidades_info', id)
        // Conferência: só remove se for fixture da prova (observacao marca a prova)
        const obs = rec.getString('observacao') || ''
        if (obs.indexOf('fixture de prova FA-1') !== -1) {
          app.delete(rec)
          removidos++
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
