// LT-1-T07 — Conector do Google Agenda: importação de reuniões elegíveis
// POST /backend/v1/agenda/importar  body: { empresa, dias_atras?, dias_frente? }
// Regras aplicadas (F1-T02 + SPEC-1-001 + SPEC-1-003):
//   - Elegibilidade total: agendadas, remarcadas, canceladas, concluídas — nenhuma excluída (RN-1-06)
//     showDeleted=true: evento cancelado OU excluído na agenda volta com status=cancelled
//     (a API do Google omite cancelled sem esse parâmetro — furo corrigido em 2026-10-05)
//   - Cancelada → ocorrência com motivo (RN-1-08); remarcação só com identificação confiável (RN-1-09)
//   - Chave oficial = código da unidade via lookup no título (nunca adivinhar — RN-1-19)
//   - Evento CONFIRMADO sem unidade identificável → sem_unidade (conferência humana, sem inferência)
//   - Evento CANCELADO/EXCLUÍDO sem unidade identificável → ocorrência de cancelamento com
//     portal_unit_id vazio + estado pendente (decisão do champion, 2026-10-06: RN-1-08 vence —
//     cancelamento nunca fica sem registro; a unidade é resolvida por conferência humana na fila)
//   - Idempotência: source_system=google_calendar + source_meeting_id=eventId (CA-1-05/1-08)
//   - RLS por empresa (LT-1-T06): consultora só importa a(s) empresa(s) autorizada(s)
//   - Credencial POR EMPRESA (LT-1-T08): acuidar → GOOGLE_CALENDAR_TOKEN;
//     donahelp → GOOGLE_CALENDAR_TOKEN_DONAH — cada empresa tem agenda Google própria
//     (decisão do champion, 2026-10-06). Nunca no código/chat/logs.
//   - Refresh token automático (LT-1-T09): access token do secret expira ~1h — no 401 do
//     Google, o hook renova via POST oauth2.googleapis.com/token (grant_type=refresh_token)
//     com GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET + refresh token da empresa
//     (GOOGLE_CALENDAR_REFRESH_TOKEN / _DONAH) e usa o access token novo NA MESMA requisição
//     (sem gravar de volta no secret — Skip não permite escrever secrets em runtime).
//     Renovação falha → credencial_expirada com orientação de regenerar.
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
  let credencial = $secrets.get(secretCredencial)
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
  //    LT-1-T09: access token expira ~1h — no 401, renova via refresh token da empresa
  //    (on-demand, sem gravar de volta) e refaz a chamada na mesma requisição.
  const secretRefresh =
    empresa === 'acuidar' ? 'GOOGLE_CALENDAR_REFRESH_TOKEN' : 'GOOGLE_CALENDAR_REFRESH_TOKEN_DONAH'
  const consultarAgenda = (tokenAcesso) => {
    const params =
      '?timeMin=' +
      encodeURIComponent(timeMin) +
      '&timeMax=' +
      encodeURIComponent(timeMax) +
      '&singleEvents=true&showDeleted=true&orderBy=startTime&maxResults=250'
    return $http.send({
      url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events' + params,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + tokenAcesso },
      timeout: 20,
    })
  }
  const renovarAccessToken = () => {
    const clientId = $secrets.get('GOOGLE_OAUTH_CLIENT_ID')
    const clientSecret = $secrets.get('GOOGLE_OAUTH_CLIENT_SECRET')
    const refreshToken = $secrets.get(secretRefresh)
    if (!clientId || !clientSecret || !refreshToken) {
      return { falha: 'refresh_ausente', secret: secretRefresh }
    }
    try {
      const resT = $http.send({
        url: 'https://oauth2.googleapis.com/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:
          'grant_type=refresh_token&client_id=' +
          encodeURIComponent(clientId) +
          '&client_secret=' +
          encodeURIComponent(clientSecret) +
          '&refresh_token=' +
          encodeURIComponent(refreshToken),
        timeout: 15,
      })
      let parsedT = null
      if (resT.json && typeof resT.json === 'object') parsedT = resT.json
      else if (resT.body) {
        try {
          parsedT = JSON.parse(new TextDecoder().decode(resT.body))
        } catch (errT) {
          parsedT = null
        }
      }
      if (resT.statusCode === 200 && parsedT && parsedT.access_token) {
        return { token: parsedT.access_token }
      }
      // Diagnóstico da renovação sem expor valores (erro do Google: unauthorized_client,
      // invalid_grant etc. — orienta a correção sem vazar segredo)
      const erroGoogle = parsedT && parsedT.error ? String(parsedT.error) : null
      return { falha: 'renovacao_rejeitada', http_status: resT.statusCode, erro_google: erroGoogle }
    } catch (errR) {
      return { falha: 'renovacao_falhou' }
    }
  }

  let eventos = []
  try {
    let resG = consultarAgenda(credencial)
    let renovado = false
    if (resG.statusCode === 401) {
      // Access token expirado/inválido → renovação on-demand (LT-1-T09)
      const r = renovarAccessToken()
      if (r.falha) {
        if (r.falha === 'refresh_ausente') {
          return e.json(200, {
            resultado: 'credencial_ausente',
            secret: r.secret,
            mensagem:
              'Access token do Google expirado e refresh token não configurado. Grave ' +
              r.secret +
              ' nos Secrets do Skip (Builder) — nunca pelo chat.',
          })
        }
        return e.json(200, {
          resultado: 'credencial_expirada',
          erro_google: r.erro_google || null,
          mensagem:
            'Access token do Google expirado e a renovação falhou' +
            (r.erro_google ? ' (' + r.erro_google + ')' : '') +
            '. Regenere o refresh token ' +
            secretRefresh +
            ' com o MESMO client OAuth (GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET) e regrave nos Secrets do Skip — o app em modo Teste expira o refresh token em 7 dias.',
        })
      }
      credencial = r.token
      renovado = true
      resG = consultarAgenda(credencial)
    }
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
      // RN-1-19: sem inferência — o título não identifica a unidade.
      // Decisão do champion (2026-10-06): cancelado/excluído NUNCA fica sem registro (RN-1-08) —
      // vira ocorrência de cancelamento com unidade pendente de conferência na fila.
      if (status === 'cancelled') {
        const occurrenceTypeC = 'cancelamento'
        const idempotencyKeyC = $security.sha256(
          'google_calendar:' + eventId + ':conferencia:' + occurrenceTypeC,
        )
        let existenteC = null
        try {
          existenteC = $app.findFirstRecordByFilter('ocorrencias', 'idempotency_key = {:k}', {
            k: idempotencyKeyC,
          })
        } catch (errC) {
          existenteC = null
        }
        if (existenteC) {
          resumo.ja_existentes++
        } else {
          const colC = $app.findCollectionByNameOrId('ocorrencias')
          const recC = new Record(colC)
          recC.set('source_system', 'google_calendar')
          recC.set('source_meeting_id', eventId)
          // portal_unit_id é required (min 1) — marcador 'conferencia' (não é código oficial;
          // não entra na cobertura do painel, que agrupa por unidades reais do cadastro)
          recC.set('portal_unit_id', 'conferencia')
          recC.set('occurrence_type', occurrenceTypeC)
          recC.set('data_fato', dataFato)
          recC.set('horario', horario)
          recC.set('titulo', titulo)
          recC.set(
            'relato',
            'Importado do Google Calendar — reunião cancelada/excluída sem unidade identificável no título. Unidade pendente de conferência humana (RN-1-19: sem inferência).',
          )
          recC.set('estado', 'pendente')
          recC.set('idempotency_key', idempotencyKeyC)
          recC.set(
            'motivo',
            'Reunião cancelada na agenda (importada do Google Calendar) — unidade pendente de conferência.',
          )
          recC.set('criado_por', auth.id)
          recC.set('empresa', empresa)
          try {
            $app.save(recC)
            resumo.importadas++
            resumo.canceladas++
            idsCriadas.push(recC.id)
          } catch (errC2) {
            const msgC = String(errC2 || '')
            if (msgC.indexOf('unique') !== -1 || msgC.indexOf('UNIQUE') !== -1) {
              resumo.ja_existentes++
            } else {
              resumo.erros++
            }
          }
        }
        continue
      }
      // Confirmado sem unidade → conferência humana (lista), sem ocorrência
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
