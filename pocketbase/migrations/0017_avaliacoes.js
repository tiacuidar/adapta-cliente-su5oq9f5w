// FAROL-1 (FA-2) — Collection de avaliações PECAF/PEDHE (programa anual por empresa)
// Decisões do champion (2026-10-06, sinal 06_notas/sinal-farol-unidades-pecaf-pedhe.md):
//   - Formulário dentro da intranet, preenchido pelo champion/consultoria
//   - O sistema calcula o resultado geral automaticamente (fórmula confirmada:
//     soma das 20 perguntas + pontuação do faturamento (0-20) + pontuação dos
//     contratos (0-20); no PEDHE não há contratos — pontuação de contratos = 0)
//   - PECAF anual (avaliação por convenção; referência 2026 = jun/jul)
//   - Acuidar → PECAF · Dona Help → PEDHE (mesma estrutura, parâmetros próprios)
// RLS: leitura para todos autenticados da empresa; criação/edição só gestor/admin
// (faturamento/contratos são dados de negócio — LGPD); ninguém exclui.
migrate(
  (app) => {
    const collection = new Collection({
      name: 'avaliacoes',
      type: 'base',
      listRule:
        "@request.auth.id != '' && (@request.auth.empresas_autorizadas ?~ empresa || empresa = '' && @request.auth.empresas_autorizadas ?~ 'acuidar' || @request.auth.role = 'gestor' || @request.auth.role = 'administrador')",
      viewRule:
        "@request.auth.id != '' && (@request.auth.empresas_autorizadas ?~ empresa || empresa = '' && @request.auth.empresas_autorizadas ?~ 'acuidar' || @request.auth.role = 'gestor' || @request.auth.role = 'administrador')",
      createRule:
        "@request.auth.id != '' && (@request.auth.role = 'gestor' || @request.auth.role = 'administrador')",
      updateRule:
        "@request.auth.id != '' && (@request.auth.role = 'gestor' || @request.auth.role = 'administrador') && (@request.auth.empresas_autorizadas ?~ empresa || @request.auth.role = 'gestor' || @request.auth.role = 'administrador')",
      deleteRule: null,
      fields: [
        // Programa: pefcab (acuidar) | pedhe (dona help)
        {
          name: 'programa',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['pecaf', 'pedhe'],
        },
        // Empresa (padrão multiempresa do projeto)
        {
          name: 'empresa',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['acuidar', 'donahelp'],
        },
        // Unidade pela chave oficial (código — RN-1-19: nunca por nome)
        { name: 'portal_unit_id', type: 'text', required: true, min: 1, max: 20 },
        // Ano da avaliação (PECAF/PEDHE anual)
        { name: 'ano', type: 'number', required: true, min: 2020 },
        // Referência do período de análise (ex.: "junho e julho" — Resultado 2026)
        { name: 'referencia', type: 'text', max: 100 },
        // Tempo de franquia na avaliação (mínimos do regulamento)
        { name: 'tempo_franquia', type: 'text', max: 5 },
        // 20 perguntas qualitativas (0/1/2) — q1..q20
        { name: 'q1', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q2', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q3', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q4', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q5', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q6', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q7', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q8', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q9', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q10', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q11', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q12', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q13', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q14', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q15', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q16', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q17', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q18', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q19', type: 'number', required: true, min: 0, max: 2 },
        { name: 'q20', type: 'number', required: true, min: 0, max: 2 },
        // Indicadores quantitativos
        { name: 'faturamento_bruto', type: 'number', required: false },
        { name: 'pontuacao_faturamento', type: 'number', required: true, min: 0, max: 20 },
        // Contratos mensais fixos (PECAF; no PEDHE = 0)
        { name: 'contratos_fixos', type: 'number', required: false },
        { name: 'pontuacao_contratos', type: 'number', required: true, min: 0, max: 20 },
        // Resultado geral CALCULADO pelo sistema (soma q1..q20 + pont_fat + pont_cont)
        { name: 'resultado_geral', type: 'number', required: true, min: 0 },
        // Ranqueada (SIM/NÃO) — decisão humana da convenção
        { name: 'ranqueada', type: 'select', required: true, maxSelect: 1, values: ['sim', 'nao'] },
        // Auditoria
        { name: 'preenchido_por', type: 'text', max: 64 },
        { name: 'observacao', type: 'text', max: 500 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        // Uma avaliação por unidade por programa por ano
        'CREATE UNIQUE INDEX idx_avaliacoes_unica ON avaliacoes (programa, portal_unit_id, ano)',
      ],
    })
    app.save(collection)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('avaliacoes'))
  },
)
