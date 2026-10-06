// FAROL-1 (FA-2) — Consulta de avaliações PECAF/PEDHE (leitura)
// GET /backend/v1/avaliacoes?programa=pecaf|pedhe&ano=2026
// RLS por empresa (leitura para todos autenticados da empresa); retorna as avaliações
// com resultado geral calculado e ranqueada — base para o semáforo da FA-3.
routerAdd('GET', '/backend/v1/avaliacoes', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) {
    return e.json(401, { resultado: 'erro', mensagem: 'Autenticação obrigatória.' })
  }

  const q = e.requestInfo().query || {}
  const programa = String(q.programa || '')
  const empresa = programa === 'pecaf' ? 'acuidar' : programa === 'pedhe' ? 'donahelp' : ''
  if (!empresa) {
    return e.json(200, {
      resultado: 'erro',
      mensagem: 'Programa inválido. Use pefcab (Acuidar) ou pedhe (Dona Help).',
    })
  }

  // RLS por empresa — defesa em profundidade
  const role = auth.getString('role') || 'consultor'
  let autorizadas = []
  try {
    autorizadas = auth.get('empresas_autorizadas') || []
  } catch (err) {
    autorizadas = []
  }
  const veAmbas = role === 'gestor' || role === 'administrador'
  if (!veAmbas && !autorizadas.includes(empresa)) {
    return e.json(403, {
      resultado: 'erro',
      mensagem: 'Você não tem acesso à empresa ' + empresa + '.',
    })
  }

  const ano = q.ano ? Number(q.ano) : new Date().getFullYear()

  let registros = []
  try {
    registros = $app.findRecordsByFilter(
      'avaliacoes',
      'programa = {:p} && ano = {:a}',
      '-updated',
      500,
      0,
      { p: programa, a: ano },
    )
  } catch (err) {
    return e.json(200, {
      resultado: 'dados_indisponiveis',
      motivo: 'falha_ao_ler_avaliacoes',
      empresa: empresa,
      ano: ano,
      timestamp: new Date().toISOString(),
    })
  }

  const linhas = registros.map((r) => {
    let soma = 0
    for (let i = 1; i <= 20; i++) soma += r.getInt('q' + i)
    return {
      id: r.id,
      portal_unit_id: r.getString('portal_unit_id'),
      ano: r.getInt('ano'),
      referencia: r.getString('referencia'),
      tempo_franquia: r.getString('tempo_franquia'),
      soma_perguntas: soma,
      pontuacao_faturamento: r.getInt('pontuacao_faturamento'),
      pontuacao_contratos: r.getInt('pontuacao_contratos'),
      resultado_geral: r.getInt('resultado_geral'),
      ranqueada: r.getString('ranqueada'),
      observacao: r.getString('observacao'),
      updated: r.getString('updated'),
    }
  })

  return e.json(200, {
    resultado: 'ok',
    programa: programa,
    empresa: empresa,
    ano: ano,
    total: linhas.length,
    timestamp: new Date().toISOString(),
    linhas: linhas,
  })
})
