// FA-8 (2026-10-07) — Tela Agenda: reuniões AGENDADAS + FEITAS do dia, por empresa
// GET /backend/v1/agenda/dia?empresa=acuidar|donahelp&data=YYYY-MM-DD
// Pedido do champion (13:07, autorizado 13:08 "Pode implementar"): "um topico no menu que se
// chamará agenda e ele vai mostrar uma agenda já com as reuniões agendadas e também feitas,
// dando para a consultora um panorama das reuniões daquele dia, e essa agenda tbm vai aparecer
// pra administração ver tudo o que as consultoras estão fazendo".
// Fonte: collection `ocorrencias` (google_calendar + entrada_assistida) — data_fato = data.
//   AGENDADAS = data_fato >= hoje (fato ainda não ocorrido)
//   FEITAS    = data_fato < hoje (fato ocorrido) — inclui canceladas (RN-1-08: nunca exclui)
//   (AP-2026-10-07-1300: registro no período = fato OCORRIDO; fato futuro é planejamento)
// RLS por empresa (padrão LT-1-T06): consultor só a(s) autorizada(s); gestor/admin ambas.
// "Quem registrou": nome do usuário (join users) — a administração vê o que as consultoras fazem.
// Somente leitura; sem inferência (RN-1-19); sem toLocaleString no JSVM (AP-2026-10-06-1710).

routerAdd('GET', '/backend/v1/agenda/dia', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) {
    return e.json(401, { resultado: 'erro', mensagem: 'Autenticação obrigatória.' })
  }

  const q = e.requestInfo().query || {}
  const empresa = String(q.empresa || 'acuidar')
  const data = String(q.data || '')

  if (empresa !== 'acuidar' && empresa !== 'donahelp') {
    return e.json(200, {
      resultado: 'erro',
      mensagem: 'Empresa inválida. Use acuidar ou donahelp.',
    })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return e.json(200, { resultado: 'erro', mensagem: 'Data inválida. Use YYYY-MM-DD.' })
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

  // Janela do dia: [data 00:00, data+1 00:00)
  const ano = Number(data.slice(0, 4))
  const mes = Number(data.slice(5, 7))
  const dia = Number(data.slice(8, 10))
  const dt = new Date(Date.UTC(ano, mes - 1, dia))
  const dtProx = new Date(dt.getTime() + 86400000)
  const ini = data + ' 00:00:00.000Z'
  const fim = dtProx.toISOString().slice(0, 10) + ' 00:00:00.000Z'

  // Hoje (UTC) para separar AGENDADAS × FEITAS (AP-2026-10-07-1300: fato ocorrido vs futuro)
  const hoje = new Date().toISOString().slice(0, 10)

  // Ocorrências do dia (todas as fontes — google_calendar + entrada_assistida)
  let ocs = []
  try {
    ocs = $app.findRecordsByFilter(
      'ocorrencias',
      'empresa = {:empresa} && data_fato >= {:ini} && data_fato < {:fim}',
      'data_fato,horario',
      500,
      0,
      { empresa: empresa, ini: ini, fim: fim },
    )
  } catch (err) {
    ocs = []
  }

  // Nomes dos usuários (quem registrou) — mapa id → nome
  const nomePorId = {}
  try {
    const usuarios = $app.findRecordsByFilter('users', '', 'created', 500, 0)
    for (const u of usuarios) {
      nomePorId[u.id] = u.getString('name') || u.getString('email') || u.id
    }
  } catch (err) {
    // sem nomes — usa o id
  }

  // Nome da unidade (código oficial — nunca adivinha, RN-1-19)
  let unidadePorCodigo = {}
  try {
    const tokenName = empresa === 'acuidar' ? 'ACUIDAR_PORTAL_TOKEN' : 'DONAHELP_PORTAL_TOKEN'
    const urlUnidades =
      empresa === 'acuidar'
        ? 'https://app.acuidarbr.com.br/api/dados/unidades'
        : 'https://app.donahelpbr.com.br/api/dados/unidades'
    const portalToken = $secrets.get(tokenName)
    if (portalToken) {
      const resU = $http.send({
        url: urlUnidades,
        method: 'GET',
        headers: { Authorization: portalToken },
        timeout: 15,
      })
      let parsed = null
      if (resU.json && typeof resU.json === 'object') parsed = resU.json
      else if (resU.body) {
        try {
          parsed = JSON.parse(new TextDecoder().decode(resU.body))
        } catch (err2) {
          parsed = null
        }
      }
      let lista = null
      if (Array.isArray(parsed)) lista = parsed
      else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.dados)) lista = parsed.dados
        else if (Array.isArray(parsed.data)) lista = parsed.data
        else if (Array.isArray(parsed.unidades)) lista = parsed.unidades
      }
      if (lista) {
        for (const u of lista) {
          unidadePorCodigo[String(u.codigo || '')] = String(u.nome || '')
        }
      }
    }
  } catch (errU) {
    // sem nomes de unidade — usa o código
  }

  const agendadas = []
  const feitas = []
  const contagens = {
    total: ocs.length,
    agendadas: 0,
    feitas: 0,
    confirmadas: 0,
    pendentes: 0,
    canceladas: 0,
  }

  for (const oc of ocs) {
    const dataFato = (oc.getString('data_fato') || '').slice(0, 10)
    const portalUnitId = oc.getString('portal_unit_id') || ''
    const estado = oc.getString('estado') || ''
    const criadoPor = oc.getString('criado_por') || ''
    const item = {
      id: oc.id,
      horario: oc.getString('horario') || '',
      titulo: oc.getString('titulo') || '',
      tipo: oc.getString('occurrence_type') || '',
      estado: estado,
      unidade_codigo: portalUnitId,
      unidade_nome:
        unidadePorCodigo[portalUnitId] ||
        (portalUnitId === 'conferencia' ? '(conferência humana)' : portalUnitId),
      fonte: oc.getString('source_system') || '',
      criado_por_id: criadoPor,
      criado_por_nome: nomePorId[criadoPor] || criadoPor || '(desconhecido)',
      google_sync_estado: oc.getString('google_sync_estado') || '',
      relato: oc.getString('relato') || '',
      motivo: oc.getString('motivo') || '',
    }
    if (estado === 'confirmado') contagens.confirmadas++
    else if (estado === 'pendente') contagens.pendentes++
    if (dataFato >= hoje) {
      agendadas.push(item)
      contagens.agendadas++
    } else {
      feitas.push(item)
      contagens.feitas++
    }
    if (
      item.titulo.toLowerCase().includes('cancelad') ||
      (estado === 'confirmado' && item.tipo.toLowerCase().includes('cancelamento'))
    ) {
      contagens.canceladas++
    }
  }

  return e.json(200, {
    resultado: 'ok',
    empresa: empresa,
    data: data,
    hoje: hoje,
    gerado_em: new Date().toISOString(),
    contagens: contagens,
    fonte: 'intranet (ocorrencias — google_calendar + entrada_assistida) — tempo real',
    agendadas: agendadas,
    feitas: feitas,
  })
})
