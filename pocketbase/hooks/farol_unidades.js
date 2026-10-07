// FAROL-1 (FA-7, 2026-10-07) — Farol das Unidades: SEMÁFORO PECAF/PEDHE + MAPA DE
// ACOMPANHAMENTO mensal (reuniões) + STATUS DE ATIVIDADE, com gráficos na tela.
// GET /backend/v1/farol?empresa=acuidar|donahelp
// Decisão do champion (2026-10-07 12:36, autorizada 12:40 "Pode implementar"): o mapa de
// acompanhamento VOLTA ao farol (reversão parcial da FA-6) ALÉM do semáforo — os dois convivem.
// Regras do mapa = as aprovadas e provadas na FA-1 (2026-10-06, "ok pode prosseguir"):
//   em_dia          = registro no mês corrente OU reunião programada
//   proximo_atraso  = sem registro no mês corrente a partir do dia 20
//   em_atraso       = sem registro no mês corrente E mês anterior vazio
//   programada      = reunião futura na agenda (sem registro no mês corrente)
//   nao_retorna     = 3+ tentativas sem retorno (unidades_info) — VENCE as demais
// Regras do semáforo (aprovadas 2026-10-06, INTACTAS):
//   SEMÁFORO (FA-3 — regra aprovada; mínimos dos regulamentos dos PDFs):
//     verde  = ranqueada = SIM
//     amarelo= ranqueada = NÃO mas atinge os mínimos do regulamento para o tempo de franquia
//     vermelho= ranqueada = NÃO abaixo dos mínimos OU sem avaliação no ano (sem dados)
//     sem_classificacao = unidade com menos de 3 meses sem avaliação (não se aplica — ex. Palmas/Camaçari)
//   Mínimos PECAF (contratos + faturamento): 3m→2/10k · 4m→3/15k · 6m→4/20k · 1a→8/60k ·
//     2a→15/120k · 3a→25/200k · 4a→40/260k · 5a→50/300k (>= 5a usa a faixa de 5a)
//   Mínimos PEDHE (só faturamento): 3m→10k · 6m→20k · 8m→30k · 10m→40k · 12m→60k ·
//     14m→70k · 16m→80k · 18m→100k · 2a→120k · 3a→200k (>= 3a usa a faixa de 3a)
//   Tempo de franquia: da avaliação (carga/formulário) ou de unidades_info (fallback).
//   Sem inferência (RN-1-19); RLS por empresa (padrão LT-1-T06); somente leitura.
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

  // FA-7 (decisão champion 2026-10-07 12:36, autorizada 12:40): o MAPA DE ACOMPANHAMENTO
  // volta ao farol (reversão parcial da FA-6) ALÉM do semáforo — os dois convivem.
  // Ocorrências do mês corrente (banco local, tempo real — mesma fonte do painel de cobertura).
  const agora = new Date()
  const mesCorrente = agora.toISOString().slice(0, 7)
  const iniMes = mesCorrente + '-01 00:00:00.000Z'
  const diaDoMes = agora.getUTCDate()
  // "Registro no mês" = fato JÁ OCORRIDO (data_fato <= hoje) — reunião futura do mesmo mês é
  // PROGRAMADA, não registro (pego pela prova: fixture 2026-10-20 contava como registro)
  const amanhaISO = new Date(agora.getTime() + 86400000).toISOString().slice(0, 10)
  const fimMes = amanhaISO + ' 00:00:00.000Z'

  // Registros do mês corrente por unidade (fatos ocorridos — elegibilidade total RN-1-18)
  const registroNoMes = {}
  try {
    const ocs = $app.findRecordsByFilter(
      'ocorrencias',
      'empresa = {:empresa} && data_fato >= {:ini} && data_fato < {:fim}',
      '-created',
      500,
      0,
      { empresa: empresa, ini: iniMes, fim: fimMes },
    )
    for (const oc of ocs) {
      const uid = oc.getString('portal_unit_id')
      if (!uid) continue
      registroNoMes[uid] = (registroNoMes[uid] || 0) + 1
    }
  } catch (err) {
    // falha ao ler ocorrências → mapa com contagem zerada (sem inferência)
    registroNoMes = {}
  }

  // Reuniões programadas (futuras) por unidade — título com código oficial ou nome exato
  // (RN-1-19: NUNCA adivinha; mesmo padrão do conector Google da LT-1-T07)
  const programadaPorUnidade = {}
  try {
    const agoraISO = agora.toISOString().slice(0, 10)
    const ocsFuturas = $app.findRecordsByFilter(
      'ocorrencias',
      'empresa = {:empresa} && data_fato > {:hoje}',
      '-created',
      500,
      0,
      { empresa: empresa, hoje: agoraISO },
    )
    for (const oc of ocsFuturas) {
      const uid = oc.getString('portal_unit_id')
      if (!uid || uid === 'conferencia') continue
      const dataFato = (oc.getString('data_fato') || '').slice(0, 10)
      if (!programadaPorUnidade[uid] || dataFato < programadaPorUnidade[uid]) {
        programadaPorUnidade[uid] = dataFato
      }
    }
  } catch (err) {
    programadaPorUnidade = {}
  }

  // 4. unidades_info: status de atividade + tentativas sem retorno + tempo de franquia
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
        tempo_franquia: i.getString('tempo_franquia') || '',
        updated: i.getString('updated') || '',
      }
    }
  } catch (err) {
    infoPorUnidade = {}
  }

  // 5. Avaliações do ano corrente (programa da empresa) — base do semáforo
  const programa = empresa === 'acuidar' ? 'pecaf' : 'pedhe'
  const anoAvaliacao = agora.getFullYear()
  let avalPorUnidade = {}
  try {
    const avals = $app.findRecordsByFilter(
      'avaliacoes',
      'programa = {:p} && ano = {:a}',
      '-updated',
      500,
      0,
      { p: programa, a: anoAvaliacao },
    )
    for (const av of avals) {
      avalPorUnidade[av.getString('portal_unit_id')] = {
        id: av.id,
        resultado_geral: av.getInt
          ? av.getInt('resultado_geral')
          : Number(av.getString('resultado_geral') || 0),
        ranqueada: av.getString('ranqueada') || '',
        tempo_franquia: av.getString('tempo_franquia') || '',
        referencia: av.getString('referencia') || '',
        faturamento_bruto: Number(av.getString('faturamento_bruto') || 0),
        contratos_fixos:
          av.getInt && av.getString('contratos_fixos') !== ''
            ? av.getInt('contratos_fixos')
            : av.getString('contratos_fixos') === ''
              ? null
              : Number(av.getString('contratos_fixos') || 0),
        contagem_qualitativa:
          av.getString('contagem_qualitativa') === ''
            ? null
            : Number(av.getString('contagem_qualitativa') || 0),
      }
    }
  } catch (err) {
    avalPorUnidade = {}
  }

  // 6. Mínimos dos regulamentos (PDFs) e classificação do semáforo
  // tempo → meses: '3m'=3, '1a'=12, '2a'=24, '10a'=120...
  const tempoParaMeses = (t) => {
    const s = String(t || '').trim()
    if (!s) return null
    const m = s.match(/^(\d+)\s*(m|a)$/i)
    if (!m) return null
    const n = Number(m[1])
    return m[2].toLowerCase() === 'a' ? n * 12 : n
  }
  const MIN_PECAF = [
    { meses: 3, contratos: 2, fat: 10000 },
    { meses: 4, contratos: 3, fat: 15000 },
    { meses: 6, contratos: 4, fat: 20000 },
    { meses: 12, contratos: 8, fat: 60000 },
    { meses: 24, contratos: 15, fat: 120000 },
    { meses: 36, contratos: 25, fat: 200000 },
    { meses: 48, contratos: 40, fat: 260000 },
    { meses: 60, contratos: 50, fat: 300000 },
  ]
  const MIN_PEDHE = [
    { meses: 3, fat: 10000 },
    { meses: 6, fat: 20000 },
    { meses: 8, fat: 30000 },
    { meses: 10, fat: 40000 },
    { meses: 12, fat: 60000 },
    { meses: 14, fat: 70000 },
    { meses: 16, fat: 80000 },
    { meses: 18, fat: 100000 },
    { meses: 24, fat: 120000 },
    { meses: 36, fat: 200000 },
  ]
  const faixaPecaf = (meses) => {
    let f = null
    for (const x of MIN_PECAF) {
      if (meses >= x.meses) f = x
    }
    return f
  }
  const faixaPedhe = (meses) => {
    let f = null
    for (const x of MIN_PEDHE) {
      if (meses >= x.meses) f = x
    }
    return f
  }

  const classificarSemaforo = (av, tempoInfo) => {
    // Sem avaliação no ano:
    if (!av) {
      const meses = tempoParaMeses(tempoInfo)
      if (meses !== null && meses < 3) {
        return {
          semaforo: 'sem_classificacao',
          motivo: 'unidade com menos de 3 meses — não se aplica',
        }
      }
      return { semaforo: 'vermelho', motivo: 'sem avaliação no ano (sem dados)' }
    }
    if (av.ranqueada === 'sim') {
      return { semaforo: 'verde', motivo: 'ranqueada = SIM' }
    }
    // ranqueada = NÃO → compara com os mínimos do regulamento
    const tempo = av.tempo_franquia || tempoInfo || ''
    const meses = tempoParaMeses(tempo)
    if (meses === null) {
      return { semaforo: 'vermelho', motivo: 'sem tempo de franquia para verificar os mínimos' }
    }
    if (programa === 'pecaf') {
      const f = faixaPecaf(meses)
      if (!f)
        return { semaforo: 'vermelho', motivo: 'tempo de franquia fora das faixas do regulamento' }
      const contratos = av.contratos_fixos
      const fat = av.faturamento_bruto
      if (contratos === null || contratos === undefined || !fat) {
        return { semaforo: 'vermelho', motivo: 'dados de contratos/faturamento ausentes' }
      }
      if (contratos >= f.contratos && fat >= f.fat) {
        return {
          semaforo: 'amarelo',
          motivo: 'atinge os mínimos (' + f.contratos + ' contratos / R$ ' + f.fat + ')',
        }
      }
      return {
        semaforo: 'vermelho',
        motivo: 'abaixo dos mínimos (' + f.contratos + ' contratos / R$ ' + f.fat + ')',
      }
    }
    const f = faixaPedhe(meses)
    if (!f)
      return { semaforo: 'vermelho', motivo: 'tempo de franquia fora das faixas do regulamento' }
    const fat = av.faturamento_bruto
    if (!fat) return { semaforo: 'vermelho', motivo: 'faturamento ausente' }
    // JSVM não tem toLocaleString (AP-2026-10-06-1710) — número puro no motivo
    if (fat >= f.fat) {
      return {
        semaforo: 'amarelo',
        motivo: 'atinge o mínimo (R$ ' + f.fat + ')',
      }
    }
    return {
      semaforo: 'vermelho',
      motivo: 'abaixo do mínimo (R$ ' + f.fat + ')',
    }
  }

  // 7. Montar linhas (semáforo anual + mapa mensal FA-7)
  const linhas = []
  const semaforoContagem = { verde: 0, amarelo: 0, vermelho: 0, sem_classificacao: 0 }
  const statusAtividadeContagem = {
    ativa: 0,
    treinada: 0,
    suspensa: 0,
    fechada: 0,
    sem_status: 0,
  }
  const mapaContagem = {
    em_dia: 0,
    nao_retorna: 0,
    proximo_atraso: 0,
    em_atraso: 0,
    programada: 0,
  }

  // Prioridade de exibição/ordenação: nao_retorna → em_atraso → proximo_atraso → programada → em_dia
  const PRIORIDADE = { nao_retorna: 0, em_atraso: 1, proximo_atraso: 2, programada: 3, em_dia: 4 }

  for (const u of unidades) {
    const info = infoPorUnidade[u.codigo] || null
    const statusAtividade = info ? info.status_atividade : ''
    if (statusAtividade === 'ativa') statusAtividadeContagem.ativa++
    else if (statusAtividade === 'treinada') statusAtividadeContagem.treinada++
    else if (statusAtividade === 'suspensa') statusAtividadeContagem.suspensa++
    else if (statusAtividade === 'fechada') statusAtividadeContagem.fechada++
    else statusAtividadeContagem.sem_status++

    const av = avalPorUnidade[u.codigo] || null
    const tempoInfo = info ? info.tempo_franquia : ''
    const sem = classificarSemaforo(av, tempoInfo)
    semaforoContagem[sem.semaforo] = (semaforoContagem[sem.semaforo] || 0) + 1

    // MAPA DE ACOMPANHAMENTO — regras aprovadas na FA-1 (nao_retorna vence as demais)
    const tentativas = info ? Number(info.tentativas_sem_retorno || 0) : 0
    const registros = registroNoMes[u.codigo] || 0
    const proxima = programadaPorUnidade[u.codigo] || ''
    let classificacao = ''
    if (tentativas >= 3) {
      classificacao = 'nao_retorna'
    } else if (proxima) {
      // reunião futura na agenda → programada (se também tem registro no mês, em_dia vence? —
      // regra FA-1: em_dia = registro no mês corrente OU programada; programada é categoria
      // própria quando NÃO há registro no mês corrente)
      classificacao = registros > 0 ? 'em_dia' : 'programada'
    } else if (registros > 0) {
      classificacao = 'em_dia'
    } else if (diaDoMes >= 20) {
      classificacao = 'proximo_atraso'
    } else {
      classificacao = 'em_atraso'
    }
    mapaContagem[classificacao] = (mapaContagem[classificacao] || 0) + 1

    linhas.push({
      codigo: u.codigo,
      nome: u.nome,
      cidade: u.cidade,
      status_atividade: statusAtividade,
      observacao: info ? info.observacao : '',
      semaforo: sem.semaforo,
      semaforo_motivo: sem.motivo,
      classificacao: classificacao,
      prioridade: PRIORIDADE[classificacao] !== undefined ? PRIORIDADE[classificacao] : 9,
      registro_no_mes: registros,
      proxima_programada: proxima,
      tentativas_sem_retorno: tentativas,
      avaliacao: av
        ? {
            id: av.id,
            resultado_geral: av.resultado_geral,
            ranqueada: av.ranqueada,
            tempo_franquia: av.tempo_franquia,
            referencia: av.referencia,
            faturamento_bruto: av.faturamento_bruto,
            contratos_fixos: av.contratos_fixos,
          }
        : null,
    })
  }

  // Ordenação por prioridade do mapa (nao_retorna primeiro)
  linhas.sort((a, b) => a.prioridade - b.prioridade || a.nome.localeCompare(b.nome))

  return e.json(200, {
    resultado: 'ok',
    empresa: empresa,
    programa: programa,
    ano_avaliacao: anoAvaliacao,
    mes_referencia: mesCorrente,
    gerado_em: new Date().toISOString(),
    total_unidades: unidades.length,
    semaforo_contagem: semaforoContagem,
    status_atividade_contagem: statusAtividadeContagem,
    mapa_contagem: mapaContagem,
    fonte_unidades:
      empresa === 'acuidar'
        ? 'Portal Acuidar — atualização diária'
        : 'Portal Dona Help — atualização diária',
    fonte_status_atividade:
      'intranet (unidades_info) — cadastro provisório até a API do Portal expor o campo',
    fonte_semaforo:
      'intranet (avaliacoes ' +
      programa +
      ' ' +
      anoAvaliacao +
      ') + regulamento ' +
      programa.toUpperCase(),
    fonte_mapa:
      'intranet (ocorrencias do mês corrente + programadas — banco local, tempo real) + unidades_info (tentativas)',
    fonte_status_atividade:
      'intranet (unidades_info) — cadastro provisório até a API do Portal expor o campo',
    linhas: linhas,
  })
})
