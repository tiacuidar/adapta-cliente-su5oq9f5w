// LT-1-T05 — Limpeza das fixtures de teste da fase 1 / leva técnica
// Exclui SOMENTE os registros criados como fixtures de teste (identificados por ID fixo,
// conferidos um a um contra os padrões de título de teste antes da escrita desta migration).
// A política "nunca excluir" vale para ocorrências reais de negócio (cancelamento/remarcação);
// fixtures de teste não são registros operacionais.
// Preservado: t7nfareuzlwkwr7 ("Acompanhamento — Acuidar JP Centro (teste exceção)") — registro
// que o Champion aprovou no teste humano da LT-1-T03; mantido como histórico real do fluxo.

const FIXTURES = [
  '18l0hqe6k413h4v',
  'wt02yp2kpzxm7ba',
  'znyparwfzzv1sbq',
  'b60k2nkubfyg8ha',
  'znw1umdd77mvf42',
  'njim8llgjdcc863',
  'gjpixwleunh03m7',
  'vawpiamoyef54q2',
  '7mknzawseyhfaty',
  'd9uq1p9wuk7s98m',
  'aspk6i9bz5pd7ll',
  'bzuq0l0e47ldr4x',
  'ddfbi2z928szif8',
  'cw2dnnimvb9lqwb',
  'curtk1y74pshddx',
  '2fkg4usxi9rbxc3',
  'hpsbcienr2sz8io',
  'sc9v14w5z4w7xft',
  '3kqqnxbwow4klhp',
  'zwygfyiwq4vx04s',
  'nh9l3v0eg0h5as1',
  'dlbbulv1nzo63zp',
  'j03ks2jcrfh53ps',
  '6q025fw33iu4xpq',
  '3l8ansm0w8zby0a',
  '7908jmsljsvfxs1',
]

migrate(
  (app) => {
    let excluidos = 0
    for (const id of FIXTURES) {
      try {
        const rec = app.findRecordById('ocorrencias', id)
        app.delete(rec)
        excluidos++
      } catch (err) {
        // já excluído ou inexistente — idempotente, segue
      }
    }
  },
  (app) => {
    // Down: não recria fixtures (dados de teste não são restauráveis por design)
  },
)
