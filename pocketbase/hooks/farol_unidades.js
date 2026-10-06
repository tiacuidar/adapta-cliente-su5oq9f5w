// FAROL-1 (farol consolidado = FA-3+FA-4) — Farol das Unidades: mapa + SEMÁFORO PECAF/PEDHE
// GET /backend/v1/farol?empresa=acuidar|donahelp
// Regras aprovadas pelo champion (2026-10-06, sinal 06_notas/sinal-farol-unidades-pecaf-pedhe.md
// + decisões 13:42 do farol consolidado):
//   Mapa (cadência MENSAL — FA-1, inalterada):
//     em_dia        = ocorrência no mês corrente OU reunião programada futura
//     proximo_atraso= sem registro no mês corrente E dia >= 20 do mês
//     em_atraso     = sem registro no mês corrente (antes do dia 20) OU mês anterior sem registro
//     programada    = próxima reunião na agenda futura (independe do registro)
//     nao_retorna   = tentativas_sem_retorno >= 3 (unidades_info)
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
    if (fat >= f.fat) {
      return {
        semaforo: 'amarelo',
        motivo: 'atinge o mínimo (R$ ' + f.fat.toLocaleString('pt-BR') + ')',
      }
    }
    return {
      semaforo: 'vermelho',
      motivo: 'abaixo do mínimo (R$ ' + f.fat.toLocaleString('pt-BR') + ')',
    }
  }

  // 7. Classificar cada unidade (mapa mensal + semáforo anual)
  const linhas = []
  const contagens = {
    em_dia: 0,
    proximo_atraso: 0,
    em_atraso: 0,
    programada: 0,
    nao_retorna: 0,
    sem_classificacao: 0,
  }
  const semaforoContagem = { verde: 0, amarelo: 0, vermelho: 0, sem_classificacao: 0 }
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
      classificacao = 'em_dia'
    }

    if (contagens[classificacao] !== undefined) contagens[classificacao]++

    const statusAtividade = info ? info.status_atividade : ''
    if (statusAtividade === 'ativa') statusAtividadeContagem.ativa++
    else if (statusAtividade === 'treinada') statusAtividadeContagem.treinada++
    else if (statusAtividade === 'suspensa') statusAtividadeContagem.suspensa++
    else if (statusAtividade === 'fechada') statusAtividadeContagem.fechada++
    else statusAtividadeContagem.sem_status++

    const av = avalPorUnidade[u.codigo] || null
    const tempoInfo = info ? info.tempo_franquia : ''
    const sem = classificarSemaforo(av, tempoInfo)
    if (sem.semaforo === 'vermelho' && av && av.ranqueada === 'nao') {
      // vermelho por mínimos — conta como vermelho
    }
    semaforoContagem[sem.semaforo] = (semaforoContagem[sem.semaforo] || 0) + 1

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
      semaforo: sem.semaforo,
      semaforo_motivo: sem.motivo,
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

  return e.json(200, {
    resultado: 'ok',
    empresa: empresa,
    programa: programa,
    ano_avaliacao: anoAvaliacao,
    mes_referencia: mesCorrente + ' (cadência mensal — 30/31 dias conforme calendário)',
    gerado_em: new Date().toISOString(),
    total_unidades: unidades.length,
    contagens: contagens,
    semaforo_contagem: semaforoContagem,
    status_atividade_contagem: statusAtividadeContagem,
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
    linhas: linhas,
  })
})
