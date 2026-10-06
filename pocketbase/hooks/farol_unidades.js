// FAROL-1 (FA-1) — Farol das Unidades: mapa de acompanhamento por unidade
// GET /backend/v1/farol?empresa=acuidar|donahelp
// Regras aprovadas pelo champion (2026-10-06, sinal 06_notas/sinal-farol-unidades-pecaf-pedhe.md):
//   - Cadência MENSAL (30/31 dias conforme calendário — alinhada à janela RN-1-16):
//     em_dia        = ocorrência no mês corrente OU reunião programada futura
//     proximo_atraso= sem registro no mês corrente E dia >= 20 do mês
//     em_atraso     = sem registro no mês corrente (antes do dia 20) OU mês anterior sem registro
//     programada    = próxima reunião na agenda futura (independe do registro)
//     nao_retorna   = tentativas_sem_retorno >= 3 (unidades_info)
//   - Sem inferência (RN-1-19): unidade fora do cadastro não é classificada.
//   - RLS por empresa (defesa em profundidade — padrão LT-1-T06): 403 se não autorizada.
//   - Somente leitura. Status de atividade vem de unidades_info (cadastro provisório —
//     a API do Portal entregará o campo no futuro).
// NOTA JSVM: toda a lógica inline no callback (sem constantes top-level fora de uso).

routerAdd('GET', '/backend/v1/farol', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) {
    return e.json(401, { resultado: 'erro', mensagem: 'Autenticação obrigatória.' })
  }

  const q = e.requestInfo().query || {}
  const empresa = String(q.empresa || 'acuidar')

  if (empresa !== 'acuidar' && empresa !== 'donahelp') {
    return e.json(200, {
      resultado: 'erro',
      mensagem: 'Empresa inválida. Use acuidar ou donahelp.',
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

  // 1. Unidades da empresa (mesma fonte do painel — parser por formato)
  const tokenName = empresa === 'acuidar' ? 'ACUIDAR_PORTAL_TOKEN' : 'DONAHELP_PORTAL_TOKEN'
  const urlUnidades =
    empresa === 'acuidar'
      ? 'https://app.acuidarbr.com.br/api/dados/unidades'
      : 'https://app.donahelpbr.com.br/api/dados/unidades'
  const token = $secrets.get(tokenName)
  if (!token) {
    return e.json(200, {
      resultado: 'dados_indisponiveis',
      motivo: 'credencial_ausente',
      fonte: tokenName,
      empresa: empresa,
      timestamp: new Date().toISOString(),
    })
  }

  let unidades = []
  try {
    const res = $http.send({
      url: urlUnidades,
      method: 'GET',
      headers: { Authorization: token },
      timeout: 15,
    })
    if (res.statusCode === 200) {
      let parsed = null
      if (res.json && typeof res.json === 'object') parsed = res.json
      else if (res.body) {
        try {
          parsed = JSON.parse(new TextDecoder().decode(res.body))
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
        unidades = lista.map((u) => ({
          codigo: String(u.codigo || ''),
          nome: String(u.nome || ''),
          cidade: String(u.cidade || ''),
        }))
      }
    }
  } catch (err) {
    unidades = []
  }
  if (unidades.length === 0) {
    return e.json(200, {
      resultado: 'dados_indisponiveis',
      motivo: 'fonte_de_unidades_indisponivel',
      fonte: tokenName,
      empresa: empresa,
      timestamp: new Date().toISOString(),
    })
  }

  // 2. Ocorrências do mês corrente E do mês anterior (cadência mensal)
  const agora = new Date()
  const mesCorrente = agora.toISOString().slice(0, 7)
  const diaDoMes = agora.getUTCDate()
  const anoCor = Number(mesCorrente.slice(0, 4))
  const mesNum = Number(mesCorrente.slice(5, 7))
  const mesAnterior =
    mesNum === 1 ? String(anoCor - 1) + '-12' : anoCor + '-' + String(mesNum - 1).padStart(2, '0')
  const iniCorrente = mesCorrente + '-01 00:00:00.000Z'
  const iniProximo =
    mesNum === 12 ? String(anoCor + 1) + '-01' : anoCor + '-' + String(mesNum + 1).padStart(2, '0')
  const iniAnterior = mesAnterior + '-01 00:00:00.000Z'

  const lerPorMes = (ini, fim) => {
    try {
      return $app.findRecordsByFilter(
        'ocorrencias',
        "empresa = {:empresa} && data_fato >= {:ini} && data_fato < {:fim} && portal_unit_id != 'conferencia'",
        '-created',
        1000,
        0,
        { empresa: empresa, ini: ini, fim: fim },
      )
    } catch (err) {
      return []
    }
  }
  const ocorrCorrente = lerPorMes(iniCorrente, iniProximo + ' 00:00:00.000Z')
  const ocorrAnterior = lerPorMes(iniAnterior, iniCorrente)

  // 3. Reuniões programadas futuras (agenda: eventos futuros já importados)
  //    Fonte: ocorrências com data_fato futura (agendadas pela agenda/importação ou manual)
  const hoje = agora.toISOString().slice(0, 10)
  let programadasPorUnidade = {}
  try {
    const futuras = $app.findRecordsByFilter(
      'ocorrencias',
      "empresa = {:empresa} && data_fato >= {:hoje} && occurrence_type != 'cancelamento'",
      'data_fato',
      1000,
      0,
      { empresa: empresa, hoje: hoje },
    )
    for (const f of futuras) {
      const uid = f.getString('portal_unit_id')
      if (!programadasPorUnidade[uid]) programadasPorUnidade[uid] = []
      programadasPorUnidade[uid].push(f.getString('data_fato').slice(0, 10))
    }
  } catch (err) {
    programadasPorUnidade = {}
  }

  // 4. unidades_info: status de atividade + tentativas sem retorno
  let infoPorUnidade = {}
  try {
    const infos = $app.findRecordsByFilter(
      'unidades_info',
      'empresa = {:empresa}',
      '-updated',
      500,
      0,
      {
        empresa: empresa,
      },
    )
    for (const i of infos) {
      infoPorUnidade[i.getString('portal_unit_id')] = {
        status_atividade: i.getString('status_atividade') || '',
        tentativas_sem_retorno: i.getInt
          ? i.getInt('tentativas_sem_retorno')
          : Number(i.getString('tentativas_sem_retorno') || 0),
        observacao: i.getString('observacao') || '',
        updated: i.getString('updated') || '',
      }
    }
  } catch (err) {
    infoPorUnidade = {}
  }

  // 5. Classificar cada unidade (cadência mensal aprovada)
  const linhas = []
  const contagens = {
    em_dia: 0,
    proximo_atraso: 0,
    em_atraso: 0,
    programada: 0,
    nao_retorna: 0,
    sem_classificacao: 0,
  }
  const statusAtividadeContagem = {
    ativa: 0,
    treinada: 0,
    suspensa: 0,
    fechada: 0,
    sem_status: 0,
  }

  for (const u of unidades) {
    let registroCorrente = 0
    for (const oc of ocorrCorrente) {
      if (oc.getString('portal_unit_id') === u.codigo) registroCorrente++
    }
    let registroAnterior = 0
    for (const oc of ocorrAnterior) {
      if (oc.getString('portal_unit_id') === u.codigo) registroAnterior++
    }
    const programadas = programadasPorUnidade[u.codigo] || []
    const info = infoPorUnidade[u.codigo] || null
    const tentativas = info ? Number(info.tentativas_sem_retorno || 0) : 0

    let classificacao = 'em_atraso'
    if (tentativas >= 3) {
      classificacao = 'nao_retorna'
    } else if (registroCorrente > 0) {
      classificacao = 'em_dia'
    } else if (programadas.length > 0) {
      classificacao = 'programada'
    } else if (diaDoMes >= 20) {
      classificacao = 'proximo_atraso'
    } else if (registroAnterior === 0) {
      classificacao = 'em_atraso'
    } else {
      // início do mês sem registro ainda, mas mês anterior teve → em dia pela cadência mensal
      classificacao = 'em_dia'
    }

    if (contagens[classificacao] !== undefined) contagens[classificacao]++

    const statusAtividade = info ? info.status_atividade : ''
    if (statusAtividade === 'ativa') statusAtividadeContagem.ativa++
    else if (statusAtividade === 'treinada') statusAtividadeContagem.treinada++
    else if (statusAtividade === 'suspensa') statusAtividadeContagem.suspensa++
    else if (statusAtividade === 'fechada') statusAtividadeContagem.fechada++
    else statusAtividadeContagem.sem_status++

    linhas.push({
      codigo: u.codigo,
      nome: u.nome,
      cidade: u.cidade,
      classificacao: classificacao,
      registro_no_mes: registroCorrente,
      registro_mes_anterior: registroAnterior,
      proxima_programada: programadas.length > 0 ? programadas[0] : '',
      status_atividade: statusAtividade,
      tentativas_sem_retorno: tentativas,
      observacao: info ? info.observacao : '',
    })
  }

  // Unidades fechadas/suspensas aparecem com seu status — o mapa as mantém visíveis
  // (elegibilidade total: nenhuma unidade é escondida por suposição)

  return e.json(200, {
    resultado: 'ok',
    empresa: empresa,
    mes_referencia: mesCorrente + ' (cadência mensal — 30/31 dias conforme calendário)',
    gerado_em: new Date().toISOString(),
    total_unidades: unidades.length,
    contagens: contagens,
    status_atividade_contagem: statusAtividadeContagem,
    fonte_unidades:
      empresa === 'acuidar'
        ? 'Portal Acuidar — atualização diária'
        : 'Portal Dona Help — atualização diária',
    fonte_status_atividade:
      'intranet (unidades_info) — cadastro provisório até a API do Portal expor o campo',
    linhas: linhas,
  })
})
