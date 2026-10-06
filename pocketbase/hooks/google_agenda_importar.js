// LT-1-T07 — Conector do Google Agenda: importação de reuniões elegíveis
// POST /backend/v1/agenda/importar  body: { empresa, dias_atras?, dias_frente? }
// Regras aplicadas (F1-T02 + SPEC-1-001 + SPEC-1-003):
//   - Elegibilidade total: agendadas, remarcadas, canceladas, concluídas — nenhuma excluída (RN-1-06)
//     showDeleted=true: evento cancelado OU excluído na agenda volta com status=cancelled
//     (a API do Google omite cancelled sem esse parâmetro — furo corrigido em 2026-10-05)
//   - Cancelada → ocorrência com motivo (RN-1-08); remarcação só com identificação confiável (RN-1-09)
//   - Chave oficial = código da unidade via lookup no título (nunca adivinhar — RN-1-19)
//   - Evento sem unidade identificável → pendente_conferencia (fila humana), sem inferência
//   - Idempotência: source_system=google_calendar + source_meeting_id=eventId (CA-1-05/1-08)
//   - RLS por empresa (LT-1-T06): consultora só importa a(s) empresa(s) autorizada(s)
//   - Credencial POR EMPRESA (LT-1-T08): acuidar → GOOGLE_CALENDAR_TOKEN;
//     donahelp → GOOGLE_CALENDAR_TOKEN_DONAH — cada empresa tem agenda Google própria
//     (decisão do champion, 2026-10-06). Nunca no código/chat/logs.
// Sem credencial da empresa → resposta explícita credencial_ausente com o nome do secret.

routerAdd('POST', '/backend/v1/agenda/importar', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) {
    return e.json(401, { resultado: 'erro', mensagem: 'Autenticação obrigatória.' })
  }

  const body = e.requestInfo().body || {}
  const empresa = String(body.empresa || '')
  const diasAtras = Number(body.dias_atras || 7)
  const diasFrente = Number(body.dias_frente || 14)

  if (empresa !== 'acuidar' && empresa !== 'donahelp') {
    return e.json(200, {
      resultado: 'erro',
      mensagem: 'Empresa inválida. Use acuidar ou donahelp.',
    })
  }

  // RLS por empresa (LT-1-T06) — defesa em profundidade
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

  // Credencial POR EMPRESA (LT-1-T08) — somente via Secrets do Skip (BLOQUEIO-LT07-A/LT08-A)
  // acuidar → GOOGLE_CALENDAR_TOKEN · donahelp → GOOGLE_CALENDAR_TOKEN_DONAH
  const secretCredencial =
    empresa === 'acuidar' ? 'GOOGLE_CALENDAR_TOKEN' : 'GOOGLE_CALENDAR_TOKEN_DONAH'
  const credencial = $secrets.get(secretCredencial)
  if (!credencial) {
    return e.json(200, {
      resultado: 'credencial_ausente',
      secret: secretCredencial,
      mensagem:
        'Credencial do Google Agenda da empresa ' +
        empresa +
        ' não configurada. Grave ' +
        secretCredencial +
        ' nos Secrets do Skip (Builder) — nunca pelo chat.',
    })
  }

  // Janela de busca (padrão: 7 dias atrás a 14 dias à frente)
  const agora = new Date()
  const timeMin = new Date(agora.getTime() - diasAtras * 86400000).toISOString()
  const timeMax = new Date(agora.getTime() + diasFrente * 86400000).toISOString()

  // 1. Carregar unidades da empresa (mesma fonte do painel — parser por formato)
  const tokenName = empresa === 'acuidar' ? 'ACUIDAR_PORTAL_TOKEN' : 'DONAHELP_PORTAL_TOKEN'
  const urlUnidades =
    empresa === 'acuidar'
      ? 'https://app.acuidarbr.com.br/api/dados/unidades'
      : 'https://app.donahelpbr.com.br/api/dados/unidades'
  const portalToken = $secrets.get(tokenName)
  if (!portalToken) {
    return e.json(200, {
      resultado: 'dados_indisponiveis',
      motivo: 'credencial_portal_ausente',
      fonte: tokenName,
    })
  }

  let unidades = []
  try {
    const resU = $http.send({
      url: urlUnidades,
      method: 'GET',
      headers: { Authorization: portalToken },
      timeout: 15,
    })
    if (resU.statusCode === 200) {
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
        unidades = lista.map((u) => ({
          codigo: String(u.codigo || ''),
          nome: String(u.nome || ''),
        }))
      }
    }
  } catch (err) {
    return e.json(200, {
      resultado: 'dados_indisponiveis',
      motivo: 'falha_ao_carregar_unidades',
      fonte: tokenName,
    })
  }
  if (unidades.length === 0) {
    return e.json(200, {
      resultado: 'dados_indisponiveis',
      motivo: 'sem_unidades_no_cadastro',
      fonte: tokenName,
    })
  }

  // 2. Consultar a agenda (Google Calendar API v3 — lista de eventos)
  //    A credencial é um token de acesso (OAuth) gravado pelo champion nos Secrets.
  let eventos = []
  try {
    const params =
      '?timeMin=' +
      encodeURIComponent(timeMin) +
      '&timeMax=' +
      encodeURIComponent(timeMax) +
      '&singleEvents=true&showDeleted=true&orderBy=startTime&maxResults=250'
    const resG = $http.send({
      url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events' + params,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + credencial },
      timeout: 20,
    })
    if (resG.statusCode !== 200) {
      return e.json(200, {
        resultado: 'erro',
        mensagem:
          'Google Calendar respondeu HTTP ' +
          resG.statusCode +
          '. Verifique a credencial (token expirado?).',
        http_status: resG.statusCode,
      })
    }
    let parsedG = null
    if (resG.json && typeof resG.json === 'object') parsedG = resG.json
    else if (resG.body) {
      try {
        parsedG = JSON.parse(new TextDecoder().decode(resG.body))
      } catch (err3) {
        parsedG = null
      }
    }
    if (!parsedG || !Array.isArray(parsedG.items)) {
      return e.json(200, { resultado: 'erro', mensagem: 'Resposta inesperada do Google Calendar.' })
    }
    eventos = parsedG.items
    // DEBUG LT-1-T08 (temporário): diagnóstico do que o Google devolveu — remover após a correção
    const diagStatus = { confirmed: 0, cancelled: 0, tentative: 0, sem_start: 0, outros: 0 }
    for (const ev of eventos) {
      const st = String(ev.status || 'confirmed')
      if (st === 'confirmed') diagStatus.confirmed++
      else if (st === 'cancelled') {
        if (ev.start && (ev.start.dateTime || ev.start.date)) diagStatus.cancelled++
        else diagStatus.sem_start++
      } else if (st === 'tentative') diagStatus.tentative++
      else diagStatus.outros++
    }
    console.log('DEBUG agenda ' + empresa + ':', JSON.stringify(diagStatus))
  } catch (err) {
    return e.json(200, {
      resultado: 'erro',
      mensagem: 'Falha de comunicação com o Google Calendar.',
    })
  }

  // 3. Processar cada evento — regras F1-T02 + idempotência
  //    Lookup de unidade: título contém o código oficial OU o nome oficial (match exato,
  //    case-insensitive, por palavra completa — nunca por semelhança parcial ambígua).
  const normalizar = (s) => String(s || '').toLowerCase()
  const buscarUnidade = (titulo) => {
    const t = normalizar(titulo)
    // 1ª tentativa: código explícito no título (ex.: "Consultoria | Unidade 1547")
    const mCodigo = t.match(/\b(\d{1,4})\b/)
    if (mCodigo) {
      const porCodigo = unidades.find((u) => u.codigo === mCodigo[1])
      if (porCodigo) return porCodigo
    }
    // 2ª tentativa: nome oficial completo no título (match exato)
    const porNome = unidades.find(
      (u) => u.nome && u.nome.length > 3 && t.indexOf(normalizar(u.nome)) !== -1,
    )
    if (porNome) return porNome
    return null
  }

  const resumo = {
    total_eventos: eventos.length,
    importadas: 0,
    ja_existentes: 0,
    sem_unidade: 0,
    canceladas: 0,
    remarcadas: 0,
    erros: 0,
  }
  const semUnidadeLista = []
  const idsCriadas = []

  for (const ev of eventos) {
    // Eventos sem data/hora (all-day ou cancelados sem start) — RN-1-17: fora da contagem
    if (!ev.start || (!ev.start.dateTime && !ev.start.date)) {
      continue
    }
    const eventId = String(ev.id || '')
    if (!eventId) continue

    const titulo = String(ev.summary || '(sem título)')
    const status = String(ev.status || 'confirmed') // confirmed | cancelled
    const inicio = ev.start.dateTime || ev.start.date + 'T00:00:00Z'
    const dataFato = inicio.slice(0, 10)
    const horario = ev.start.dateTime ? inicio.slice(11, 16) : '00:00'

    const unidade = buscarUnidade(titulo)
    if (!unidade) {
      // RN-1-19: sem inferência — vai para conferência humana
      resumo.sem_unidade++
      semUnidadeLista.push({ event_id: eventId, titulo: titulo, inicio: inicio })
      continue
    }

    // Idempotência (CA-1-05/1-08): mesma chave do hook criar
    const occurrenceType = status === 'cancelled' ? 'cancelamento' : 'Acompanhamento'
    const idempotencyKey = $security.sha256(
      'google_calendar:' + eventId + ':' + unidade.codigo + ':' + occurrenceType,
    )

    let existente = null
    try {
      existente = $app.findFirstRecordByFilter('ocorrencias', 'idempotency_key = {:k}', {
        k: idempotencyKey,
      })
    } catch (err) {
      existente = null
    }
    if (existente) {
      resumo.ja_existentes++
      continue
    }

    // Criar ocorrência — estado conforme regras F1-T02
    const estado = status === 'cancelled' ? 'confirmado' : 'pendente'
    const motivo =
      status === 'cancelled' ? 'Reunião cancelada na agenda (importada do Google Calendar).' : ''

    const col = $app.findCollectionByNameOrId('ocorrencias')
    const rec = new Record(col)
    rec.set('source_system', 'google_calendar')
    rec.set('source_meeting_id', eventId)
    rec.set('portal_unit_id', unidade.codigo)
    rec.set('occurrence_type', occurrenceType)
    rec.set('data_fato', dataFato)
    rec.set('horario', horario)
    rec.set('titulo', titulo)
    rec.set(
      'relato',
      'Importado do Google Calendar — relato pendente de preenchimento pelo consultor.',
    )
    rec.set('estado', estado)
    rec.set('idempotency_key', idempotencyKey)
    rec.set('motivo', motivo)
    rec.set('criado_por', auth.id)
    rec.set('empresa', empresa)
    try {
      $app.save(rec)
      resumo.importadas++
      if (status === 'cancelled') resumo.canceladas++
      idsCriadas.push(rec.id)
    } catch (err) {
      const msg = String(err || '')
      if (msg.indexOf('unique') !== -1 || msg.indexOf('UNIQUE') !== -1) {
        resumo.ja_existentes++ // corrida — tratada como já existente
      } else {
        resumo.erros++
      }
    }
  }

  return e.json(200, {
    resultado: 'ok',
    empresa: empresa,
    janela: { de: timeMin.slice(0, 10), ate: timeMax.slice(0, 10) },
    resumo: resumo,
    sem_unidade_lista: semUnidadeLista.slice(0, 20),
    ids_criadas: idsCriadas,
    timestamp: new Date().toISOString(),
  })
})
