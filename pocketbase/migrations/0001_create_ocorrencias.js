// F1-T06 — Collection de ocorrências da intranet (emenda de arquitetura 2026-09-30)
// Ocorrência criada e armazenada na intranet; Portal Acuidar = somente leitura.
// SPEC-1-001/1-002: chave de idempotência persistida ANTES da chamada de criação;
// consulta de recuperação diferencia confirmada / ausente / inconclusivo.
migrate(
  (app) => {
    const collection = new Collection({
      name: 'ocorrencias',
      type: 'base',
      // RLS provisória da fase 1: somente autenticados; a matriz nominal (F1-T04)
      // substituirá estas regras quando aprovada.
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        // Origem da reunião (Google Agenda ou entrada assistida autorizada)
        { name: 'source_system', type: 'text', required: true, min: 1, max: 50 },
        { name: 'source_meeting_id', type: 'text', required: true, min: 1, max: 255 },
        // Unidade pela chave oficial (código do Portal Acuidar — F1-T02)
        { name: 'portal_unit_id', type: 'text', required: true, min: 1, max: 20 },
        { name: 'occurrence_type', type: 'text', required: true, min: 1, max: 50 },
        // Dados da ocorrência
        { name: 'data_fato', type: 'date', required: true },
        { name: 'horario', type: 'text', required: true, max: 10 },
        { name: 'titulo', type: 'text', required: true, min: 1, max: 200 },
        { name: 'relato', type: 'editor', required: true, maxSize: 100000 },
        // Estado da máquina da SPEC-1-002
        {
          name: 'estado',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: [
            'pendente',
            'em_revisao',
            'aguardando_correcao',
            'aguardando_aprovacao_de_excecao',
            'possivel_duplicidade',
            'falha_de_gravacao',
            'confirmado',
          ],
        },
        // Chave de idempotência — SHA-256(source_system:source_meeting_id:portal_unit_id:occurrence_type)
        { name: 'idempotency_key', type: 'text', required: true, min: 64, max: 64 },
        // ID retornado pelo destino (na emenda, o próprio ID do registro da intranet)
        { name: 'portal_occurrence_id', type: 'text', max: 64 },
        // Motivo auditável (cancelamento, remarcação, falha)
        { name: 'motivo', type: 'text', max: 500 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        // CA-1-05/CA-1-08: reenvio do mesmo source não cria segunda ocorrência
        'CREATE UNIQUE INDEX idx_ocorrencias_idempotency ON ocorrencias (idempotency_key)',
        'CREATE INDEX idx_ocorrencias_unidade_data ON ocorrencias (portal_unit_id, data_fato)',
        'CREATE INDEX idx_ocorrencias_estado ON ocorrencias (estado)',
      ],
    })
    app.save(collection)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('ocorrencias'))
  },
)
