// LT-2-T01 — campos de sincronização intranet→Google Calendar na collection ocorrencias
// Migration idempotente (padrão AP-2026-10-06-1258: parâmetro app; campos adicionados
// somente se ausentes). O registro NUNCA depende do Google: google_sync_estado registra
// sincronizada | nao_sincronizada | nao_aplicavel; google_event_id guarda o ID do evento
// criado; google_sync_erro guarda o motivo da falha (retry por botão, nunca automático).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('ocorrencias')
    const desejados = [
      { name: 'google_event_id', type: 'text', required: false },
      { name: 'google_sync_estado', type: 'text', required: false },
      { name: 'google_sync_erro', type: 'text', required: false },
    ]
    let alterou = false
    for (const d of desejados) {
      let f = null
      try {
        f = col.fields.getByName(d.name)
      } catch (err) {
        f = null
      }
      if (!f) {
        col.fields.add(new Field(d))
        alterou = true
      }
    }
    if (alterou) {
      app.save(col)
    }
    console.log('0026 campos google_sync: aplicada (alterou=' + alterou + ')')
  },
  (app) => {
    // Down: não remove campos (histórico de sincronização é preservado)
  },
)
