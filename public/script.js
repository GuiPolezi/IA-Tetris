const canvas = document.getElementById('tetris');
const context = canvas.getContext('2d');
const nextCanvas = document.getElementById('next');
const nextContext = nextCanvas.getContext('2d');

// --- CONFIGURAÇÃO ---
const BLOCK_SIZE = 35; 
const NEXT_BLOCK_SIZE = 18; 
const COLS = 10;
const ROWS = 20;
const LOCK_DELAY_MS = 500; 

// Socket e Estado
const socket = io();
let currentRoomId = null;
let currentRoomPlayers = [];
let isHost = false;
let isGameRunning = false;

// Variável de controle do menu
let isMenuOpen = false;

// Variável que define o modo de jogo (você já deve ter algo assim)
// Exemplo: 'single' ou 'multi'
let gameMode = 'single'; // ou defina dinamicamente quando o jogo começar

const pauseMenu = document.getElementById('pause-menu');
const btnResume = document.getElementById('btn-resume');
const btnQuit = document.getElementById('btn-quit');

// Função para Alternar o Menu
function toggleMenu() {
    isMenuOpen = !isMenuOpen;
    
    if (isMenuOpen) {
        pauseMenu.style.display = 'flex'; // Mostra o menu
    } else {
        pauseMenu.style.display = 'none'; // Esconde o menu
    }
}

// Event Listeners para os botões
btnResume.addEventListener('click', toggleMenu);

btnQuit.addEventListener('click', () => {
    // Aqui vai sua lógica de sair (refresh na página ou desconectar socket)
    window.location.reload(); 
});

// Listener da tecla ESC
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        toggleMenu();
    }
});

// --- SISTEMA DE ÁUDIO ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

const sounds = {
    move: () => playSound('triangle', 300, 0.05, 0.05),
    rotate: () => playSound('sine', 400, 0.05, 0.1, 500),
    drop: () => playSound('square', 150, 0.05, 0.2, 50),
    clear: () => {
        setTimeout(() => playSound('sine', 523.25, 0.1, 0.3), 0);
        setTimeout(() => playSound('sine', 659.25, 0.1, 0.3), 100);
        setTimeout(() => playSound('sine', 783.99, 0.1, 0.3), 200);
        setTimeout(() => playSound('sine', 1046.50, 0.2, 0.6), 300);
    },
    gameOver: () => playSound('sawtooth', 300, 0.5, 1.0, 50)
};

function playSound(type, freq, attack, decay, slideFreq = null) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    if (slideFreq) {
        osc.frequency.exponentialRampToValueAtTime(slideFreq, audioCtx.currentTime + decay);
    }
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + attack); 
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + attack + decay);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + attack + decay);
}

document.addEventListener('keydown', () => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
}, { once: true });

// --- RENDERIZAÇÃO ---
function resizeCanvas(cvs, ctx, width, height) {
    const scale = window.devicePixelRatio || 1;
    cvs.width = width * scale;
    cvs.height = height * scale;
    cvs.style.width = width + 'px';
    cvs.style.height = height + 'px';
    ctx.scale(scale, scale);
}

resizeCanvas(canvas, context, COLS * BLOCK_SIZE, ROWS * BLOCK_SIZE);
resizeCanvas(nextCanvas, nextContext, 100, 80); 

const colors = [
    null,
    '#FF4757', '#FFA502', '#ECCC68', '#2ED573', 
    '#1E90FF', '#3742FA', '#A4B0BE', '#505050' 
];

const arena = createMatrix(COLS, ROWS);

const player = {
    pos: {x: 0, y: 0},
    matrix: null,
    score: 0,
    level: 1,
    lines: 0,
    name: 'Player'
};

let nextPieceMatrix = null;
let dropCounter = 0;
let dropInterval = 1000;
let lastTime = 0;
let lockDelayTimer = 0;
let gameOver = false;

// --- FUNÇÕES DE DESENHO ---
function drawBlock(ctx, x, y, colorIndex, size, alpha = 1) {
    ctx.fillStyle = colors[colorIndex];
    ctx.globalAlpha = alpha;
    ctx.fillRect(x * size, y * size, size, size);
    
    ctx.globalAlpha = 0.2 * alpha;
    ctx.fillStyle = 'white';
    ctx.fillRect(x * size, y * size, size, 2);
    ctx.fillRect(x * size, y * size, 2, size);
    ctx.fillStyle = 'black';
    ctx.fillRect(x * size, (y + 1) * size - 2, size, 2);
    ctx.fillRect((x + 1) * size - 2, y * size, 2, size);
    
    ctx.globalAlpha = 1; 
}

function draw() {
    context.fillStyle = '#121214';
    context.fillRect(0, 0, canvas.width, canvas.height);

    drawGrid(context, BLOCK_SIZE, COLS, ROWS);

    // Ghost Piece
    if (isGameRunning) {
        const ghostPos = { ...player.pos };
        while (!collide(arena, { pos: ghostPos, matrix: player.matrix })) {
            ghostPos.y++;
        }
        ghostPos.y--; 
        
        if (ghostPos.y !== player.pos.y) {
            player.matrix.forEach((row, y) => {
                row.forEach((value, x) => {
                    if (value !== 0) {
                        context.strokeStyle = colors[value];
                        context.lineWidth = 2;
                        context.globalAlpha = 0.3;
                        context.strokeRect((x + ghostPos.x) * BLOCK_SIZE, (y + ghostPos.y) * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
                        context.globalAlpha = 1;
                    }
                });
            });
        }
    }

    // Arena
    arena.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) drawBlock(context, x, y, value, BLOCK_SIZE);
        });
    });

    // Peça Atual
    if (isGameRunning) {
        player.matrix.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) drawBlock(context, x + player.pos.x, y + player.pos.y, value, BLOCK_SIZE);
            });
        });
    }
}

function drawGrid(ctx, size, cols, rows) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= cols; x++) {
        ctx.moveTo(x * size, 0);
        ctx.lineTo(x * size, rows * size);
    }
    for (let y = 0; y <= rows; y++) {
        ctx.moveTo(0, y * size);
        ctx.lineTo(cols * size, y * size);
    }
    ctx.stroke();
}

function drawNext() {
    nextContext.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!nextPieceMatrix) return;

    const boxW = 100 / NEXT_BLOCK_SIZE; 
    const boxH = 80 / NEXT_BLOCK_SIZE;
    const offsetX = (boxW - nextPieceMatrix[0].length) / 2;
    const offsetY = (boxH - nextPieceMatrix.length) / 2;

    nextPieceMatrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                drawBlock(nextContext, x + offsetX, y + offsetY, value, NEXT_BLOCK_SIZE);
            }
        });
    });
}

// --- LÓGICA DO JOGO ---
let pieceBag = [];
function getNextPiece() {
    if (pieceBag.length === 0) {
        const pieces = 'ILJOTSZ';
        pieceBag = pieces.split('').map(type => createPiece(type));
        for (let i = pieceBag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pieceBag[i], pieceBag[j]] = [pieceBag[j], pieceBag[i]];
        }
    }
    return pieceBag.pop();
}

function createPiece(type) {
    if (type === 'I') return [[0, 5, 0, 0],[0, 5, 0, 0],[0, 5, 0, 0],[0, 5, 0, 0]];
    if (type === 'L') return [[0, 2, 0],[0, 2, 0],[0, 2, 2]];
    if (type === 'J') return [[0, 6, 0],[0, 6, 0],[6, 6, 0]];
    if (type === 'O') return [[3, 3],[3, 3]];
    if (type === 'Z') return [[1, 1, 0],[0, 1, 1],[0, 0, 0]];
    if (type === 'S') return [[0, 4, 4],[4, 4, 0],[0, 0, 0]];
    if (type === 'T') return [[0, 7, 0],[7, 7, 7],[0, 0, 0]];
}

function createMatrix(w, h) {
    const matrix = [];
    while (h--) matrix.push(new Array(w).fill(0));
    return matrix;
}

function merge(arena, player) {
    player.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                arena[y + player.pos.y][x + player.pos.x] = value;
            }
        });
    });
    broadcastGameState();
}

function rotate(matrix, dir) {
    for (let y = 0; y < matrix.length; ++y) {
        for (let x = 0; x < y; ++x) {
            [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
        }
    }
    if (dir > 0) matrix.forEach(row => row.reverse());
    else matrix.reverse();
}

function playerRotate(dir) {
    const pos = player.pos.x;
    let offset = 1;
    rotate(player.matrix, dir);
    while (collide(arena, player)) {
        player.pos.x += offset;
        offset = -(offset + (offset > 0 ? 1 : -1));
        if (offset > player.matrix[0].length) {
            rotate(player.matrix, -dir);
            player.pos.x = pos;
            return;
        }
    }
}

function collide(arena, player) {
    const m = player.matrix;
    const o = player.pos;
    for (let y = 0; y < m.length; ++y) {
        for (let x = 0; x < m[y].length; ++x) {
            if (m[y][x] !== 0 && (arena[y + o.y] && arena[y + o.y][x + o.x]) !== 0) {
                return true;
            }
        }
    }
    return false;
}

function arenaSweep() {
    let rowCount = 0;
    
    outer: for (let y = arena.length - 1; y > 0; --y) {
        for (let x = 0; x < arena[y].length; ++x) {
            if (arena[y][x] === 0) {
                continue outer;
            }
        }
        
        const row = arena.splice(y, 1)[0];
        const newEmptyRow = new Array(COLS).fill(0);
        arena.unshift(newEmptyRow);
        
        ++y; 
        rowCount++;
    }
    
    if (rowCount > 0) {
        if (rowCount === 4) sounds.clear(); 
        else sounds.clear();
        
        const lineScores = [0, 40, 100, 300, 1200];
        player.score += lineScores[rowCount] * player.level;
        player.lines += rowCount;
        player.level = Math.floor(player.lines / 10) + 1;
        
        // FÓRMULA RECOMENDADA (Curva Suave):
        // A cada nível, a velocidade aumenta em cerca de 10%.
        // Math.pow(0.9, ...) significa 90% do tempo anterior.
        dropInterval = 1000 * Math.pow(0.9, player.level - 1);
        updateScore();
        broadcastGameState();
    }
}

// Adicione em qualquer lugar junto com suas funções auxiliares
function getBoardSnapshot() {
    // 1. Cria uma cópia profunda da Arena atual (para não alterar a original)
    const snapshot = arena.map(row => [...row]);

    // 2. Se o jogo estiver rodando, desenha a peça do jogador nessa cópia
    if (isGameRunning && player.matrix) {
        player.matrix.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    const py = y + player.pos.y;
                    const px = x + player.pos.x;
                    
                    // Verifica limites para não dar erro
                    if (snapshot[py] && snapshot[py][px] !== undefined) {
                        snapshot[py][px] = value;
                    }
                }
            });
        });
    }
    return snapshot;
}

function playerReset() {
    if (nextPieceMatrix === null) nextPieceMatrix = getNextPiece();
    player.matrix = nextPieceMatrix;
    nextPieceMatrix = getNextPiece();
    
    player.pos.y = 0;
    player.pos.x = (arena[0].length / 2 | 0) - (player.matrix[0].length / 2 | 0);
    
    if (collide(arena, player)) {
        isGameRunning = false; 
        
        context.fillStyle = 'rgba(50, 50, 50, 0.75)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        
        context.fillStyle = '#fff';
        context.font = '2px Arial';
        context.fillText('ESPECTADOR', 1, 10);

        if (currentRoomId) {
            socket.emit('player_died', currentRoomId);
        } else {
            // Singleplayer reset
            arena.forEach(row => row.fill(0));
            player.score = 0;
            dropInterval = 1000;
            updateScore();
            isGameRunning = true; 
        }
    }
    drawNext();
}

function playerDrop() {
    if (!isGameRunning) return;
    player.pos.y++;
    if (collide(arena, player)) {
        player.pos.y--;
        merge(arena, player);
        playerReset();
        arenaSweep();
    }
    dropCounter = 0;
    broadcastGameState();
}

function updateScore() {
    document.getElementById('score').innerText = player.score;
    document.getElementById('level').innerText = player.level;
    if (player.score > highScore) {
        highScore = player.score;
        localStorage.setItem('tetris_highscore', highScore);
    }
}

function update(time = 0) {
    if (!isGameRunning) return;

    // Se o menu estiver aberto E for Singleplayer
    if (isMenuOpen && gameMode === 'single') {
        // Atualizamos o lastTime para o tempo atual, mas NÃO fazemos nada.
        // Isso evita que, ao voltar, o jogo calcule que passaram 10 segundos e jogue a peça lá embaixo.
        lastTime = time; 
        
        // Mantemos o loop rodando (para quando despausar ele estar pronto), mas paramos por aqui neste frame.
        requestAnimationFrame(update); 
        return; 
    }

    const deltaTime = time - lastTime;
    lastTime = time;
    dropCounter += deltaTime;

    if (dropCounter > dropInterval) {
        playerDrop();
    }

    // Lock Delay Logic
    player.pos.y++;
    let isCollidingBelow = collide(arena, player);
    player.pos.y--;

    if (isCollidingBelow) {
        lockDelayTimer += deltaTime;
        if (lockDelayTimer >= LOCK_DELAY_MS) {
            playerDrop();
            lockDelayTimer = 0;
        }
    } else {
        lockDelayTimer = 0;
    }

    draw();
    requestAnimationFrame(update);
}

document.addEventListener('keydown', event => {
    if (!isGameRunning) return;

    if (event.keyCode === 37) {
        player.pos.x--;
        if (collide(arena, player)) player.pos.x++;
        else sounds.move();
    } else if (event.keyCode === 39) {
        player.pos.x++;
        if (collide(arena, player)) player.pos.x--;
        else sounds.move();
    } else if (event.keyCode === 40) {
        playerDrop();
    } else if (event.keyCode === 81) {
        playerRotate(-1);
        sounds.rotate();
    } else if (event.keyCode === 87 || event.keyCode === 38) {
        playerRotate(1);
        sounds.rotate();
    } else if (event.keyCode === 32) {
        while (!collide(arena, player)) player.pos.y++;
        player.pos.y--;
        
        const gameContainer = document.querySelector('.game-container');
        gameContainer.classList.remove('shake');
        void gameContainer.offsetWidth; 
        gameContainer.classList.add('shake');
        
        sounds.drop();
        merge(arena, player);
        playerReset();
        arenaSweep();
        dropCounter = 0;
    }

    if (moved) {
        broadcastGameState();
    }
});

let highScore = localStorage.getItem('tetris_highscore') || 0;

function toggleMusic() {
    const bgm = document.getElementById('bgm');
    bgm.volume = 0.2; 
    if (bgm.paused) {
        const playPromise = bgm.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => console.log("Playback prevented:", error));
        }
    } else {
        bgm.pause();
    }
}

function initGame() {
    if (isGameRunning) return;
    isGameRunning = true;
    playerReset();
    updateScore();
    update();
    dropInterval = 1000; // <--- ADICIONE ISSO AQUI
}

// --- MENUS E SOCKET ---

function getName() {
    const name = document.getElementById('player-name').value;
    if (!name) { alert("Digite um nome!"); return null; }
    return name;
}

function startSinglePlayer() {
    const name = getName();
    if (!name) return;
    player.name = name;
    document.getElementById('menu-overlay').style.display = 'none';
    document.querySelector('.main-card').style.filter = 'none';

    document.querySelector('.remote-players-container').style.display = 'none';
    gameMode = 'single';
    initGame();
}

function showMultiplayerMenu() {
    const name = getName();
    if (!name) return;
    player.name = name;
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('multiplayer-menu').style.display = 'block';
}

function backToMain() {
    document.getElementById('multiplayer-menu').style.display = 'none';
    document.getElementById('main-menu').style.display = 'block';
}

function createRoom() {
    socket.emit('create_room', player.name);
}

function joinRoom() {
    const roomId = document.getElementById('room-code-input').value.toUpperCase();
    if (!roomId) { alert("Digite o código!"); return; }
    socket.emit('join_room', { roomId: roomId, playerName: player.name });
}

socket.on('room_created', (roomId) => {
    enterLobby(roomId);
    isHost = true;
});

socket.on('joined_success', (roomId) => {
    enterLobby(roomId);
    isHost = false;
});

socket.on('error_message', (msg) => alert(msg));

socket.on('remote_board_update', (data) => {
    const slotIndex = remotePlayersMap[data.id];
    if (slotIndex !== undefined) {
        const slot = document.getElementById(`remote-slot-${slotIndex}`);
        slot.querySelector('.remote-score').innerText = data.score;
        
        const remoteCanvas = slot.querySelector('.remote-canvas');
        const remoteCtx = remoteCanvas.getContext('2d');
        
        remoteCtx.fillStyle = '#000';
        remoteCtx.fillRect(0, 0, remoteCanvas.width, remoteCanvas.height);
        
        const blockSize = remoteCanvas.width / 10; 
        data.matrix.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    remoteCtx.fillStyle = colors[value];
                    remoteCtx.fillRect(x * blockSize, y * blockSize, blockSize, blockSize);
                }
            });
        });
    }
});

socket.on('update_room_state', (roomData) => {
    currentRoomPlayers = roomData.players; 
    const playersListEl = document.getElementById('players-list');
    const countEl = document.getElementById('player-count');
    const startBtn = document.getElementById('btn-start-game');

    playersListEl.innerHTML = '';
    countEl.innerText = roomData.players.length;

    roomData.players.forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="${p.name === player.name ? 'is-me' : ''}">${p.name} ${p.isHost ? '👑' : ''}</span>`;
        playersListEl.appendChild(li);
    });

    if (currentRoomPlayers.find(p => p.id === socket.id && p.isHost)) {
        isHost = true;
    } else {
        isHost = false;
    }

    if (isHost) {
        startBtn.innerText = "Iniciar Partida";
        startBtn.classList.remove('disabled');
    } else {
        startBtn.innerText = "Aguardando Host...";
        startBtn.classList.add('disabled');
    }
});

function enterLobby(roomId) {
    currentRoomId = roomId;
    document.getElementById('current-room-id').innerText = roomId;
    document.getElementById('multiplayer-menu').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'block';
}

function broadcastGameState() {
    if (!currentRoomId) return;
    // MUDANÇA AQUI: Usamos o snapshot que inclui a peça caindo
    const boardToSend = getBoardSnapshot(); 
    
    socket.emit('player_update', { 
        roomId: currentRoomId, 
        matrix: boardToSend, // Envia o tabuleiro combinado
        score: player.score 
    });
}

const remotePlayersMap = {}; 
function setupRemotePlayers() {
    let slotIndex = 0;
    currentRoomPlayers.forEach(p => {
        if (p.id !== socket.id) {
            if (slotIndex < 3) {
                remotePlayersMap[p.id] = slotIndex;
                const slot = document.getElementById(`remote-slot-${slotIndex}`);
                slot.querySelector('.remote-name').innerText = p.name;
                slotIndex++;
            }
        }
    });
}

socket.on('player_eliminated', (deadPlayerId) => {
    const slotIndex = remotePlayersMap[deadPlayerId];
    if (slotIndex !== undefined) {
        const slot = document.getElementById(`remote-slot-${slotIndex}`);
        const remoteCanvas = slot.querySelector('.remote-canvas');
        const ctx = remoteCanvas.getContext('2d');
        
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(0, 0, remoteCanvas.width, remoteCanvas.height);
        
        slot.querySelector('.remote-name').innerText += " (💀 Eliminado)";
        slot.querySelector('.remote-name').style.color = "red";
    }
});

// NOVO: Soft Reset Listener
socket.on('game_over_winner', (winner) => {
    isGameRunning = false;
    const menu = document.getElementById('menu-overlay');
    const menuBox = document.getElementById('main-menu');
    
    menu.style.display = 'flex';
    menu.style.opacity = '1';
    
    let message = "";
    if (winner.id === socket.id) {
        message = `🏆 VITÓRIA! 🏆<br>Você venceu a partida!`;
    } else {
        message = `FIM DE JOGO<br>Vencedor: <span style="color:var(--accent)">${winner.name}</span>`;
    }

    // Botão Voltar ao Lobby usa função do socket agora, não location.reload()
    menuBox.innerHTML = `
        <h1>RESULTADO</h1>
        <p style="font-size: 20px; color: #fff; margin-bottom: 20px;">${message}</p>
        <button onclick="requestLobbyReturn()" class="btn-menu">Voltar ao Lobby</button>
    `;
    
    document.getElementById('multiplayer-menu').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'none';
    menuBox.style.display = 'block';
});

// NOVO: Função para pedir reset
function requestLobbyReturn() {
    if (isHost) {
        socket.emit('reset_lobby', currentRoomId);
    } else {
        // Se não for host, apenas espera (ou podemos forçar reload se o host sumiu)
        alert("Aguardando o Host reiniciar a sala...");
    }
}

// NOVO: Listener para voltar ao Lobby (Todos)
socket.on('return_to_lobby', () => {
    // 1. Reseta Visuais
    arena.forEach(row => row.fill(0));
    player.score = 0;
    updateScore();
    draw(); // Desenha tela vazia

    // 2. Reseta Oponentes
    for (let i = 0; i < 3; i++) {
        const slot = document.getElementById(`remote-slot-${i}`);
        slot.querySelector('.remote-name').innerText = "Aguardando...";
        slot.querySelector('.remote-name').style.color = "#888"; // Reseta cor vermelha de morte
        const remoteCtx = slot.querySelector('.remote-canvas').getContext('2d');
        remoteCtx.fillStyle = '#000';
        remoteCtx.fillRect(0, 0, 100, 160);
    }

    // 3. Mostra Tela de Lobby
    document.getElementById('menu-overlay').style.display = 'flex';
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'block';
    
    // 4. Reaplica Blur
    document.querySelector('.main-card').style.filter = 'blur(5px)';
});


function requestStartGame() {
    if (!isHost) return;
    socket.emit('start_game', currentRoomId);
}

// ATUALIZADO: Com Countdown
socket.on('game_started', () => {
    document.getElementById('menu-overlay').style.display = 'none';
    document.querySelector('.main-card').style.filter = 'none';

    // --- ADICIONE ESTA LINHA ---
    document.querySelector('.remote-players-container').style.display = 'flex';
    // ---------------------------
    
    setupRemotePlayers();
    gameMode = 'multi';
    runCountdown(); // Chama o countdown em vez de initGame direto
});

// NOVO: Função de Contagem
function runCountdown() {
    const el = document.getElementById('countdown');
    el.style.display = 'block';
    
    let count = 3;
    el.innerText = count;
    el.className = 'pulse';
    
    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            el.innerText = count;
        } else if (count === 0) {
            el.innerText = "GO!";
            sounds.clear(); 
        } else {
            clearInterval(interval);
            el.style.display = 'none';
            el.className = '';
            initGame();
        }
    }, 1000);
}

// --- SISTEMA DE MÚSICA ---

const playlistData = [
    { title: "Synthwave Retro", src: "https://files.freemusicarchive.org/storage-freemusicarchive-org/music/no_curator/Tours/Enthusiast/Tours_-_01_-_Enthusiast.mp3" },
    { title: "Chiptune Level 1", src: "https://files.freemusicarchive.org/storage-freemusicarchive-org/music/no_curator/Rolemusic/The_Pirate_And_The_Dancer/Rolemusic_-_04_-_The_Pirate_And_The_Dancer.mp3" },
    { title: "Cyberpunk City", src: "https://files.freemusicarchive.org/storage-freemusicarchive-org/music/ccCommunity/Komiku/Captain_Glouglou/Komiku_-_04_-_Skate.mp3" }
];

let currentTrackIndex = 0;
const audioPlayer = document.getElementById('bgm-player');
const playBtn = document.getElementById('play-btn');
const trackNameDisplay = document.getElementById('track-name');
const playlistElement = document.getElementById('playlist');

// Inicializa Playlist
function initPlaylist() {
    playlistData.forEach((track, index) => {
        const li = document.createElement('li');
        li.innerText = track.title;
        li.addEventListener('click', () => loadTrack(index));
        playlistElement.appendChild(li);
    });
}

function loadTrack(index) {
    currentTrackIndex = index;
    audioPlayer.src = playlistData[index].src;
    trackNameDisplay.innerText = playlistData[index].title;
    
    // Atualiza visual da lista
    document.querySelectorAll('.playlist li').forEach((li, i) => {
        li.classList.toggle('active', i === index);
    });

    playAudio();
}

function playAudio() {
    audioPlayer.play()
        .then(() => playBtn.innerText = "⏸️")
        .catch(e => console.log("Interação necessária para tocar áudio"));
}

function togglePlay() {
    if (audioPlayer.paused) {
        if (!audioPlayer.src) loadTrack(0); // Carrega a primeira se estiver vazio
        else playAudio();
    } else {
        audioPlayer.pause();
        playBtn.innerText = "▶️";
    }
}

// Event Listeners
document.getElementById('prev-btn').addEventListener('click', () => {
    let newIndex = currentTrackIndex - 1;
    if (newIndex < 0) newIndex = playlistData.length - 1;
    loadTrack(newIndex);
});

document.getElementById('next-btn').addEventListener('click', () => {
    let newIndex = (currentTrackIndex + 1) % playlistData.length;
    loadTrack(newIndex);
});

document.getElementById('volume-slider').addEventListener('input', (e) => {
    audioPlayer.volume = e.target.value;
});

playBtn.addEventListener('click', togglePlay);

// Toca a próxima automaticamente quando acabar
audioPlayer.addEventListener('ended', () => {
    let newIndex = (currentTrackIndex + 1) % playlistData.length;
    loadTrack(newIndex);
});

// Inicia a lista ao carregar a página
initPlaylist();