// LT-1-T06 — RLS por empresa na collection ocorrencias
// Regra do Champion (2026-10-02T15:43Z): consultoras veem só a(s) empresa(s) autorizada(s);
// gestores/admins veem ambas. PocketBase nega por invisibilidade (404) quando a regra não passa.
// Expressão: o auth vê o registro se a empresa dele está em empresas_autorizadas,
// OU se o perfil é gestor/administrador (que têm ambas por configuração, mas a regra
// explícita evita depender só do preenchimento do campo).
// Nota: campo empresa vazio (registros pré-LT03) é tratado como 'acuidar' (padrão do painel).

const REGRA_EMPRESA =
  '(@request.auth.empresas_autorizadas ?~ empresa || ' +
  "empresa = '' && @request.auth.empresas_autorizadas ?~ 'acuidar' || " +
  "@request.auth.role = 'gestor' || @request.auth.role = 'administrador')"

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('ocorrencias')
    col.listRule = "@request.auth.id != '' && " + REGRA_EMPRESA
    col.viewRule = "@request.auth.id != '' && " + REGRA_EMPRESA
    col.createRule = "@request.auth.id != ''"
    col.updateRule =
      "@request.auth.id != '' && (estado != 'aguardando_aprovacao_de_excecao' || @request.auth.role != 'consultor') && " +
      REGRA_EMPRESA
    col.deleteRule = null
    app.save(col)
  },
  (app) => {
    // Down: voltar para a RLS da F1-T04 (por perfil, sem filtro de empresa)
    const col = app.findCollectionByNameOrId('ocorrencias')
    col.listRule = "@request.auth.id != ''"
    col.viewRule = "@request.auth.id != ''"
    col.createRule = "@request.auth.id != ''"
    col.updateRule =
      "@request.auth.id != '' && (estado != 'aguardando_aprovacao_de_excecao' || @request.auth.role != 'consultor')"
    col.deleteRule = null
    app.save(col)
  },
)
