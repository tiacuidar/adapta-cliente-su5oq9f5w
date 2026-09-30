// F1-T04 — RLS da collection ocorrencias conforme a matriz de perfis aprovada
// Matriz (06_notas/matriz-perfis-rls.md):
//   consultar          → todos autenticados (list/view)
//   editar rascunho    → todos autenticados (create/update em estados normais)
//   solicitar exceção  → todos autenticados (mover PARA aguardando_aprovacao_de_excecao)
//   aprovar exceção    → gestor/administrador apenas (consultor não toca registro
//                        em aguardando_aprovacao_de_excecao)
//   confirmar criação  → todos autenticados (transição para confirmado via fluxo)
//   excluir            → ninguém (superuser only) — cancelamento/remarcação mantêm registro
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('ocorrencias')
    col.listRule = "@request.auth.id != ''"
    col.viewRule = "@request.auth.id != ''"
    col.createRule = "@request.auth.id != ''"
    col.updateRule =
      "@request.auth.id != '' && (estado != 'aguardando_aprovacao_de_excecao' || @request.auth.role != 'consultor')"
    col.deleteRule = null
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('ocorrencias')
    // Reverter para a RLS provisória da F1-T06
    col.listRule = "@request.auth.id != ''"
    col.viewRule = "@request.auth.id != ''"
    col.createRule = "@request.auth.id != ''"
    col.updateRule = "@request.auth.id != ''"
    col.deleteRule = "@request.auth.id != ''"
    app.save(col)
  },
)
