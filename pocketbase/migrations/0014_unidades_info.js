// FAROL-1 (FA-1) — Informações operacionais da unidade (cadastro provisório na intranet)
// Status de atividade: ativa | treinada | suspensa | fechada — hoje existe no Portal Acuidar,
// mas a API ainda não expõe o campo (decisão do champion 2026-10-06: campo será criado no
// Portal, não agora). Enquanto isso, o cadastro é manual aqui (gestor/admin) e a fonte é
// substituída pela API quando ficar disponível.
// tentativas_sem_retorno: contagem de tentativas de contato sem resposta (mapa: "não retorna").
// UNIQUE (empresa, portal_unit_id) — um registro por unidade por empresa.
migrate(
  (app) => {
    const collection = new Collection({
      name: 'unidades_info',
      type: 'base',
      // RLS por empresa (padrão LT-1-T06): consultor vê só a(s) empresa(s) autorizada(s);
      // edição restrita a gestor/admin (status de atividade é dado de gestão).
      listRule:
        "@request.auth.id != '' && (@request.auth.empresas_autorizadas ?~ empresa || empresa = '' && @request.auth.empresas_autorizadas ?~ 'acuidar' || @request.auth.role = 'gestor' || @request.auth.role = 'administrador')",
      viewRule:
        "@request.auth.id != '' && (@request.auth.empresas_autorizadas ?~ empresa || empresa = '' && @request.auth.empresas_autorizadas ?~ 'acuidar' || @request.auth.role = 'gestor' || @request.auth.role = 'administrador')",
      createRule:
        "@request.auth.id != '' && (@request.auth.role = 'gestor' || @request.auth.role = 'administrador')",
      updateRule:
        "@request.auth.id != '' && (@request.auth.role = 'gestor' || @request.auth.role = 'administrador') && (@request.auth.empresas_autorizadas ?~ empresa || @request.auth.role = 'gestor' || @request.auth.role = 'administrador')",
      deleteRule: null, // ninguém exclui (padrão do projeto — superuser only)
      fields: [
        {
          name: 'empresa',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['acuidar', 'donahelp'],
        },
        // Chave oficial da unidade (código do Portal — F1-T02); nunca nome
        { name: 'portal_unit_id', type: 'text', required: true, min: 1, max: 20 },
        {
          name: 'status_atividade',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['ativa', 'treinada', 'suspensa', 'fechada'],
        },
        // Tempo de franquia (para os mínimos do PECAF/PEDHE — FA-2): '3m','4m','6m','8m','10m','12m','14m','16m','18m','1a','2a','3a','4a','5a','6a'
        { name: 'tempo_franquia', type: 'text', max: 5 },
        // Tentativas de contato sem resposta (mapa: "não retorna")
        { name: 'tentativas_sem_retorno', type: 'number', required: false, min: 0 },
        // Nota livre de contexto (ex.: motivo do suspense)
        { name: 'observacao', type: 'text', max: 500 },
        { name: 'atualizado_por', type: 'text', max: 64 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_unidades_info_unidade ON unidades_info (empresa, portal_unit_id)',
      ],
    })
    app.save(collection)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('unidades_info'))
  },
)
