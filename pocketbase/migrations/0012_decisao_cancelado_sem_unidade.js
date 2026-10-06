// LT-1-T08 — Correção da decisão do champion (2026-10-06): reunião cancelada/excluída SEM
// unidade identificável no título NUNCA fica sem registro (RN-1-08 vence RN-1-19 no conflito —
// decisão aprovada pelo champion). A collection exige portal_unit_id (required, min 1) —
// registro de cancelamento com unidade pendente de conferência usa o marcador 'conferencia'
// (não é código oficial, não entra na cobertura: o painel agrupa por unidades reais do cadastro;
// registros com marcador aparecem na fila para resolução humana).
// Sem inferência de unidade (RN-1-19 preservado): o marcador não aponta para nenhuma unidade.

migrate(
  (app) => {
    // Nenhuma mudança de esquema — o marcador é um valor de portal_unit_id (text, max 20).
    // Documentação da decisão; migração sem efeito de dados.
  },
  (app) => {
    // Down: nada
  },
)
