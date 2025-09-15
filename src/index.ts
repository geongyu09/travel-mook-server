const express = require('express')
const { createServer } = require('http')
const { WebSocketServer } = require('ws')
const jwt = require('jsonwebtoken')
const { parse } = require('url')

// Constants
const PORT = 8080
const TRAVEL_PATH = '/travel'
const TRAVEL_NAVIGATE_PATH = '/travel-navigate'
const JWT_SECRET = 'your-secret-key'

const app = express()
const httpServer = createServer(app)

// HTTP 요청 로깅 미들웨어
app.use((req: any, res: any, next: any) => {
  console.log('🌐 HTTP Request:', req.method, req.url, req.headers.upgrade ? '(WebSocket Upgrade)' : '')
  next()
})

// Upgrade 이벤트 로깅
httpServer.on('upgrade', (request: any, socket: any, head: any) => {
  console.log('🔄 HTTP Upgrade request:')
  console.log('  📍 URL:', request.url)
  console.log('  📍 Headers:', {
    'upgrade': request.headers.upgrade,
    'connection': request.headers.connection,
    'sec-websocket-version': request.headers['sec-websocket-version']
  })
})

// 통합 WebSocket 서버 설정
const wss = new WebSocketServer({
  server: httpServer,
  verifyClient: (info: any) => {
    const req = info.req
    const pathname = parse(req.url).pathname
    
    console.log('🔍 WebSocket handshake attempt:')
    console.log('  📍 URL:', req.url)
    console.log('  📍 Path:', pathname)
    
    const isValidPath = pathname === TRAVEL_PATH || pathname === TRAVEL_NAVIGATE_PATH
    console.log('  ✅ Path valid:', isValidPath, `(${pathname})`)
    
    return isValidPath
  }
})

// 기본 HTTP 라우트
app.get('/', (req: any, res: any) => {
  res.send('WebSocket Mock Server is running!')
})

// WebSocket 핸드셰이크 테스트 엔드포인트
app.get('/travel', (req: any, res: any) => {
  res.status(426).json({
    message: 'Upgrade Required - This endpoint supports WebSocket only',
    upgrade: 'websocket'
  })
})

// 서버 상태 확인용
app.get('/status', (req: any, res: any) => {
  res.json({
    status: 'running',
    endpoints: {
      travel: `ws://localhost:${PORT}${TRAVEL_PATH}`,
      travel_navigate: `ws://localhost:${PORT}${TRAVEL_NAVIGATE_PATH}`
    },
    connections: {
      total: wss.clients.size
    }
  })
})

// JWT 인증 함수 (개발용 - 항상 성공)
const verifyToken = (token: string) => {
  console.log('🔐 Token verification (mock):', token ? 'Token provided' : 'No token')
  return { userId: 'mock-user-' + Date.now() }
}

// 사용자별 상태 관리
const userSessions = new Map()

// 메시지 전송 헬퍼 함수
const sendMessage = (ws: any, event: string, responseData: any) => {
  console.log(`🔄 Attempting to send [${event}] message, WebSocket state: ${ws.readyState}`)
  
  if (ws.readyState !== 1) { // 1 = WebSocket.OPEN
    console.log('⚠️ WebSocket not ready, state:', ws.readyState)
    console.log('   States: 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED')
    return false
  }
  
  try {
    const message = JSON.stringify(responseData)
    ws.send(message)
    console.log('📤 [' + event + '] Response sent successfully:', JSON.stringify(responseData, null, 2))
    return true
  } catch (error) {
    console.log('🚨 Send message error:', error)
    return false
  }
}

// WebSocket 연결 핸들러 함수
const createWebSocketHandler = (wss: any, endpointName: string, requiresCourseId: boolean) => {
  return (ws: any) => {
    const connectionId = Math.random().toString(36).substr(2, 9)
    console.log(`🔗 WebSocket connected to ${endpointName}: ${connectionId}`)
    console.log(`📊 Total connections (${endpointName}): ${wss.clients.size}`)
    
    let isAuthenticated = false
    let userId: string | null = null

    // WebSocket 준비 후 환영 메시지 전송
    setTimeout(() => {
      sendMessage(ws, 'welcome', {
        event: 'welcome',
        message: `Connected to ${endpointName} WebSocket`,
        connectionId,
        timestamp: Date.now()
      })
    }, 100)

    // 메시지 수신 처리
    ws.on('message', (rawMessage: any) => {
      try {
        const messageStr = rawMessage.toString()
        console.log('📥 Raw message received:', messageStr)
        
        const { event, data } = JSON.parse(messageStr)
        console.log('📥 [' + event + '] Parsed data:', JSON.stringify(data, null, 2))

      switch (event) {
        case 'auth-user':
          const { authorization } = data
          const decoded = verifyToken(authorization)
          
          isAuthenticated = true
          userId = decoded.userId || connectionId
          userSessions.set(userId, {
            connectionId,
            ws,
            isGuiding: false,
            isStarted: false,
            currentIndex: 0,
            lastPosition: null,
            travelDistance: 0.0
          })
          
          sendMessage(ws, 'auth-user', {
            event: 'auth-user',
            data: null,
            status: 'success'
          })
          console.log(`✅ User authenticated: ${userId}`)
          break

        case 'start': {
          if (!isAuthenticated) {
            sendMessage(ws, 'error', { event: 'error', message: 'Authentication required' })
            return
          }

          // courseId 검증 (travel-navigate 엔드포인트에서만 필요)
          if (requiresCourseId && !data.courseId) {
            sendMessage(ws, 'error', { event: 'error', message: 'courseId is required for travel-navigate endpoint' })
            return
          }

          const startSession = userSessions.get(userId)
          if (!startSession) {
            sendMessage(ws, 'error', { event: 'error', message: 'Session not found' })
            return
          }

          const { coordinate, time, courseId } = data
          startSession.isStarted = true
          startSession.isGuiding = true
          startSession.lastPosition = coordinate
          
          console.log(`
🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️
🏔️                                                                🏔️
🏔️                   🚶‍♂️ 산행 시작! 🚶‍♀️                        🏔️
🏔️                                                                🏔️
🏔️   사용자: ${userId}                    🏔️
🏔️   엔드포인트: ${endpointName}                             🏔️
🏔️   코스 ID: ${courseId || 'N/A'}                             🏔️
🏔️   시작 좌표: [${coordinate[0]}, ${coordinate[1]}]         🏔️
🏔️   시작 시간: ${new Date(time).toLocaleString()}              🏔️
🏔️                                                                🏔️
🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️🏔️
          `)
          
          const response = {
            event: 'start',
            data: {
              index: 0,
              isArrived: false,
              isDeviation: false,
              travelDistance: 0
            },
            status: 'success'
          }
          
          console.log('🚀 Sending start response to client...')
          sendMessage(ws, 'start', response)
          break
        }

        case 'current-position': {
          if (!isAuthenticated) {
            sendMessage(ws, 'error', { event: 'error', message: 'Authentication required' })
            return
          }

          // courseId 검증 (travel-navigate 엔드포인트에서만 필요)
          if (requiresCourseId && !data.courseId) {
            sendMessage(ws, 'error', { event: 'error', message: 'courseId is required for travel-navigate endpoint' })
            return
          }

          const userSession = userSessions.get(userId)
          if (!userSession?.isStarted) {
            sendMessage(ws, 'error', { event: 'error', message: 'Start hiking first' })
            return
          }

          // pause 중일 때는 응답하지 않음
          if (!userSession.isGuiding) {
            console.log(`⏸️ Pause 중 - current-position 요청 무시: ${userId}`)
            return
          }

          const { coordinate } = data
          
          if (userSession) {
            userSession.lastPosition = coordinate
            
            // 인덱스 증가 (최대 80까지)
            const newIndex = Math.min(userSession.currentIndex + Math.floor(Math.random() * 3), 80)
            const isCompleted = newIndex >= 80
            
            // 거리 증가 (랜덤하게 0.1 ~ 0.3km씩)
            const distanceIncrement = Math.random() * 0.2 + 0.1
            userSession.travelDistance = Math.min(userSession.travelDistance + distanceIncrement, 15.0)
            
            // 목 데이터 응답
            const mockResponse = {
              event: 'current-position',
              data: {
                index: newIndex,
                isArrived: isCompleted,
                isDeviation: !isCompleted && Math.random() > 0.9,
                travelDistance: Math.round(userSession.travelDistance * 10) / 10
              },
              status: 'success'
            }
            
            userSession.currentIndex = newIndex
            
            if (isCompleted) {
              console.log(`🏁 Course completed for user: ${userId}`)
            }
            
            sendMessage(ws, 'current-position', mockResponse)
          }
          break
        }

        case 'pause': {
          if (!isAuthenticated) {
            sendMessage(ws, 'error', { event: 'error', message: 'Authentication required' })
            return
          }

          const pauseSession = userSessions.get(userId)
          if (pauseSession) {
            const { coordinate, time } = data
            pauseSession.isGuiding = false
            pauseSession.lastPosition = coordinate
            
            console.log(`⏸️ 안내 일시중지 - 사용자: ${userId}, 시간: ${time}`)
            
            sendMessage(ws, 'pause', {
              event: 'pause',
              data: {
                index: pauseSession.currentIndex,
                isArrived: false,
                isDeviation: false,
                travelDistance: Math.round(pauseSession.travelDistance * 10) / 10
              },
              status: 'success'
            })
          }
          break
        }

        case 'restart': {
          if (!isAuthenticated) {
            sendMessage(ws, 'error', { event: 'error', message: 'Authentication required' })
            return
          }

          const restartSession = userSessions.get(userId)
          if (restartSession) {
            const { coordinate, time } = data
            restartSession.isGuiding = true
            restartSession.lastPosition = coordinate
            
            // restart부터 다시 응답 시작
            const response = {
              event: 'restart',
              data: {
                index: restartSession.currentIndex,
                isArrived: false,
                isDeviation: false,
                travelDistance: Math.round(restartSession.travelDistance * 10) / 10
              },
              status: 'success'
            }
            
            sendMessage(ws, 'restart', response)
            console.log(`▶️ 안내 재개 - 사용자: ${userId}, 시간: ${time}`)
          }
          break
        }

        case 'ping': {
          console.log('📥 [ping] Received from:', userId || connectionId)
          sendMessage(ws, 'pong', { event: 'pong', timestamp: Date.now() })
          break
        }

        case 'end': {
          if (!isAuthenticated) {
            sendMessage(ws, 'error', { event: 'error', message: 'Authentication required' })
            return
          }

          const endSession = userSessions.get(userId)
          if (endSession) {
            const { coordinate, time } = data
            endSession.isGuiding = false
            endSession.isStarted = false
            
            console.log(`🛑 산행 종료 요청 - 사용자: ${userId}`)
            
            sendMessage(ws, 'end', {
              event: 'end',
              data: {
                index: endSession.currentIndex,
                isArrived: false,
                isDeviation: false,
                travelDistance: Math.round(endSession.travelDistance * 10) / 10
              },
              status: 'success'
            })
          }
          break
        }

        default: {
          console.log(`❓ Unknown event: ${event}`, data)
          sendMessage(ws, 'error', { event: 'error', message: `Unknown event: ${event}` })
        }
      }
    } catch (error) {
      console.log('🚨 Message parse error:', error)
      sendMessage(ws, 'error', { event: 'error', message: 'Invalid message format' })
    }
  })

    // 연결 종료 처리
    ws.on('close', (code: number, reason: string) => {
      console.log(`❌ WebSocket disconnected (${endpointName}): ${connectionId}`)
      console.log(`📋 Close code: ${code}, reason: ${reason || 'No reason provided'}`)
      console.log(`📊 Remaining connections (${endpointName}): ${wss.clients.size}`)
      
      if (userId) {
        userSessions.delete(userId)
        console.log(`🗑️ User session removed: ${userId}`)
      }
    })

  // 에러 처리
    ws.on('error', (error: any) => {
      console.log(`🚨 WebSocket error for ${connectionId}:`, error)
    })
  }
}

// 통합 WebSocket 연결 처리
wss.on('connection', (ws: any, request: any) => {
  const pathname = parse(request.url).pathname
  
  if (pathname === TRAVEL_PATH) {
    console.log('✅ WebSocket connection established to /travel')
    createWebSocketHandler(wss, 'travel', false)(ws)
  } else if (pathname === TRAVEL_NAVIGATE_PATH) {
    console.log('✅ WebSocket connection established to /travel-navigate')
    createWebSocketHandler(wss, 'travel-navigate', true)(ws)
  } else {
    console.log('❌ Invalid WebSocket path:', pathname)
    ws.close(1002, 'Invalid path')
  }
})

// Keep-alive 메시지 전송 (5초마다)
setInterval(() => {
  userSessions.forEach((session, userId) => {
    if (session.ws && session.ws.readyState === 1 && session.isGuiding) {
      sendMessage(session.ws, 'keep-alive', { 
        event: 'keep-alive',
        timestamp: Date.now(),
        message: 'Connection alive'
      })
    }
  })
}, 5000)

httpServer.listen(PORT, () => {
  console.log(`🚀 WebSocket mock server listening on port ${PORT}`)
  console.log(`🔗 WebSocket endpoints:`)
  console.log(`   📍 /travel (courseId 불필요): ws://localhost:${PORT}${TRAVEL_PATH}`)
  console.log(`   📍 /travel-navigate (courseId 필요): ws://localhost:${PORT}${TRAVEL_NAVIGATE_PATH}`)
  console.log(`📡 Server ready to accept connections`)
})

// 전역 에러 핸들링
httpServer.on('error', (error: any) => {
  console.error('🚨 Server error:', error)
})

// WebSocket 서버 에러 핸들링
wss.on('error', (error: any) => {
  console.error('🚨 WebSocket server error:', error)
})
