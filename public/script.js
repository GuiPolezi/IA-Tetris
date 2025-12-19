const canvas = document.getElementById('tetris');
const context = canvas.getContext('2d');
const nextCanvas = document.getElementById('next');
const nextContext = nextCanvas.getContext('2d');
let currentRoomPlayers = [];
// --- CONFIGURAÇÃO ---
const BLOCK_SIZE = 35; // AUMENTADO (Era 30) - Jogo Maior
const NEXT_BLOCK_SIZE = 18; // DIMINUÍDO - Preview Menor
const COLS = 10;
const ROWS = 20;

// Inicializa o Socket.io
const socket = io();
let currentRoomId = null;
let isHost = false;

// --- SISTEMA DE ÁUDIO (SINTETIZADOR) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

const sounds = {
    // Som curto e agudo para movimento
    move: () => {
        playSound('triangle', 300, 0.05, 0.05); 
    },
    
    // Som mais "tecnológico" para rotação
    rotate: () => {
        playSound('sine', 400, 0.05, 0.1, 500); // Com slide de frequência
    },
    
    // Som grave e percussivo para o drop
    drop: () => {
        playSound('square', 150, 0.05, 0.2, 50); // Drop de frequência rápido
    },
    
    // Som gratificante (acorde maior) para limpar linhas
    clear: () => {
        // Arpejo rápido (Dó Maior)
        setTimeout(() => playSound('sine', 523.25, 0.1, 0.3), 0);   // C5
        setTimeout(() => playSound('sine', 659.25, 0.1, 0.3), 100); // E5
        setTimeout(() => playSound('sine', 783.99, 0.1, 0.3), 200); // G5
        setTimeout(() => playSound('sine', 1046.50, 0.2, 0.6), 300); // C6
    },
    
    // Som triste de Game Over
    gameOver: () => {
        playSound('sawtooth', 300, 0.5, 1.0, 50);
    }
};

// Função auxiliar para gerar ondas sonoras
function playSound(type, freq, attack, decay, slideFreq = null) {
    // Cria os nós de áudio
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    
    // Efeito de slide (pitch bend) se solicitado
    if (slideFreq) {
        osc.frequency.exponentialRampToValueAtTime(slideFreq, audioCtx.currentTime + decay);
    }

    // Envelope de volume (ADSR simplificado)
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + attack); // Volume max 0.3 para não estourar
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + attack + decay);

    // Conecta e toca
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + attack + decay);
}

// Hack para iniciar o AudioContext (navegadores bloqueiam áudio automático)
document.addEventListener('keydown', () => {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}, { once: true });



// Função para corrigir resolução em telas HD/Retina
function resizeCanvas(cvs, ctx, width, height) {
    const scale = window.devicePixelRatio || 1;
    // Tamanho real em pixels na memória
    cvs.width = width * scale;
    cvs.height = height * scale;
    // Tamanho visual no CSS
    cvs.style.width = width + 'px';
    cvs.style.height = height + 'px';
    // Normaliza a escala
    ctx.scale(scale, scale);
}

// Inicializa Canvas Principal
resizeCanvas(canvas, context, COLS * BLOCK_SIZE, ROWS * BLOCK_SIZE);

// Inicializa Canvas de Preview (Tamanho fixo menor visualmente)
resizeCanvas(nextCanvas, nextContext, 100, 80); 

// Paleta de Cores Moderna (Flat & Vibrant)
const colors = [
    null,
    '#FF4757', // Z (Red)
    '#FFA502', // L (Orange)
    '#ECCC68', // O (Yellow)
    '#2ED573', // S (Green)
    '#1E90FF', // I (Blue)
    '#3742FA', // J (Dark Blue)
    '#A4B0BE', // T (Grey/Purple - ajustado para modernidade)
];

const arena = createMatrix(COLS, ROWS);

const player = {
    pos: {x: 0, y: 0},
    matrix: null,
    score: 0,
    level: 1,
    lines: 0,
};

let nextPieceMatrix = null;
let dropCounter = 0;
let dropInterval = 1000;
let lastTime = 0;
let gameOver = false;

// --- FUNÇÕES DE DESENHO ---

function drawBlock(ctx, x, y, colorIndex, size, alpha = 1) {
    ctx.fillStyle = colors[colorIndex];
    ctx.globalAlpha = alpha;
    
    // Desenha o bloco
    ctx.fillRect(x * size, y * size, size, size);
    
    // Efeito de "bisel" interno sutil (luz e sombra)
    ctx.globalAlpha = 0.2 * alpha;
    ctx.fillStyle = 'white';
    ctx.fillRect(x * size, y * size, size, 2); // Topo
    ctx.fillRect(x * size, y * size, 2, size); // Esquerda
    ctx.fillStyle = 'black';
    ctx.fillRect(x * size, (y + 1) * size - 2, size, 2); // Base
    ctx.fillRect((x + 1) * size - 2, y * size, 2, size); // Direita
    
    ctx.globalAlpha = 1; // Reseta
}

function draw() {
    // Limpa o canvas (Fundo escuro levemente transparente)
    context.fillStyle = '#121214';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Grid Sutil
    drawGrid(context, BLOCK_SIZE, COLS, ROWS);

    // 1. Ghost Piece (Sombra)
    if (!gameOver) {
        const ghostPos = { ...player.pos };
        while (!collide(arena, { pos: ghostPos, matrix: player.matrix })) {
            ghostPos.y++;
        }
        ghostPos.y--; // Volta um
        
        if (ghostPos.y !== player.pos.y) {
            player.matrix.forEach((row, y) => {
                row.forEach((value, x) => {
                    if (value !== 0) {
                        // Desenha apenas o contorno para a Ghost Piece ficar clean
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

    // 2. Arena (Peças fixas)
    arena.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) drawBlock(context, x, y, value, BLOCK_SIZE);
        });
    });

    // 3. Peça Atual
    if (!gameOver) {
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
    // Limpa
    nextContext.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    
    if (!nextPieceMatrix) return;

    // Centralização dinâmica
    const boxW = 100 / NEXT_BLOCK_SIZE; // Largura do canvas em blocos pequenos
    const boxH = 80 / NEXT_BLOCK_SIZE;
    
    const offsetX = (boxW - nextPieceMatrix[0].length) / 2;
    const offsetY = (boxH - nextPieceMatrix.length) / 2;

    nextPieceMatrix.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                // Usa a função de desenho mas com o tamanho menor (NEXT_BLOCK_SIZE)
                drawBlock(nextContext, x + offsetX, y + offsetY, value, NEXT_BLOCK_SIZE);
            }
        });
    });
}

// --- LÓGICA DO JOGO (Mesma lógica robusta de antes) ---

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
    if (type === 'L') return [[0, 2, 0],[0, 2, 0],[0, 2, 2]]; // Ajustei cores
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
            if (arena[y][x] === 0) continue outer;
        }
        const row = arena.splice(y, 1)[0].fill(0);
        arena.unshift(row);
        ++y;
        rowCount++;
    }
    if (rowCount > 0) {
        sounds.clear();
        const lineScores = [0, 40, 100, 300, 1200];
        player.score += lineScores[rowCount] * player.level;
        player.lines += rowCount;
        player.level = Math.floor(player.lines / 10) + 1;
        dropInterval = Math.max(100, 1000 - (player.level - 1) * 100); 
        updateScore();
    }
    broadcastGameState();
}

function playerReset() {
    if (nextPieceMatrix === null) nextPieceMatrix = getNextPiece();
    player.matrix = nextPieceMatrix;
    nextPieceMatrix = getNextPiece();
    
    // Centraliza
    player.pos.y = 0;
    player.pos.x = (arena[0].length / 2 | 0) - (player.matrix[0].length / 2 | 0);
    
    if (collide(arena, player)) {
        sounds.gameOver();
        arena.forEach(row => row.fill(0));
        player.score = 0;
        player.level = 1;
        player.lines = 0;
        updateScore();
    }
    drawNext();
}

function playerDrop() {
    player.pos.y++;
    if (collide(arena, player)) {
        player.pos.y--;
        merge(arena, player);
        playerReset();
        arenaSweep();
    }
    dropCounter = 0;
}

function updateScore() {
    document.getElementById('score').innerText = player.score;
    document.getElementById('level').innerText = player.level;
}

function update(time = 0) {
    const deltaTime = time - lastTime;
    lastTime = time;
    dropCounter += deltaTime;
    if (dropCounter > dropInterval) playerDrop();
    draw();
    requestAnimationFrame(update);
}

document.addEventListener('keydown', event => {
    if (event.keyCode === 37) {
        player.pos.x--;
        if (collide(arena, player)) {
            player.pos.x++;
        } else {
            sounds.move();
        }
    } else if (event.keyCode === 39) {
        player.pos.x++;
        if (collide(arena, player)) {
            player.pos.x--;
        } else {
            sounds.move();
        }
    } else if (event.keyCode === 40) {
        playerDrop();
    } else if (event.keyCode === 81) {
        playerRotate(-1);
        sounds.rotate();
    } else if (event.keyCode === 87 || event.keyCode === 38) {
        playerRotate(1);
        sounds.rotate();
    } else if (event.keyCode === 32) {
    // Hard Drop logic...
        while (!collide(arena, player)) {
            player.pos.y++;
        }
        player.pos.y--;
        
        // --- ADICIONE ISSO AQUI ---
        // Pega o container do jogo
        const gameContainer = document.querySelector('.game-container');
        // Remove a classe se ela já existir para poder reiniciar
        gameContainer.classList.remove('shake');
        // Força o navegador a recalcular o estilo (hack para reiniciar animação CSS)
        void gameContainer.offsetWidth; 
        // Adiciona a classe
        gameContainer.classList.add('shake');
        // --------------------------
        sounds.drop();
        merge(arena, player);
        playerReset();
        arenaSweep();
        dropCounter = 0;
    }
});

// Tenta pegar o recorde salvo, ou começa com 0
let highScore = localStorage.getItem('tetris_highscore') || 0;

// Atualize a função updateScore para checar e desenhar o recorde
function updateScore() {
    document.getElementById('score').innerText = player.score;
    document.getElementById('level').innerText = player.level;
    
    // Verifica se bateu o recorde
    if (player.score > highScore) {
        highScore = player.score;
        localStorage.setItem('tetris_highscore', highScore);
    }
    
    // (Opcional) Você precisaria criar um elemento <div id="highscore"> no HTML
    // document.getElementById('highscore').innerText = highScore;
}

function toggleMusic() {
    const bgm = document.getElementById('bgm');
    bgm.volume = 0.2; // Garante volume baixo

    if (bgm.paused) {
        // Tenta tocar
        const playPromise = bgm.play();
        
        // Em navegadores modernos, play() retorna uma Promise
        if (playPromise !== undefined) {
            playPromise.then(_ => {
                // O áudio começou a tocar com sucesso.
                // Agora é seguro pausar se necessário.
            })
            .catch(error => {
                // O play foi impedido (ex: autoplay policy) ou interrompido.
                console.log("Playback prevented or interrupted:", error);
            });
        }
    } else {
        // Se já está tocando, pausa
        bgm.pause();
    }
}

// Variável para controlar se o jogo está rodando
let isGameRunning = false;

// Função para iniciar o loop do jogo
function initGame() {
    if (isGameRunning) return;
    isGameRunning = true;
    
    playerReset();
    updateScore();
    update();
}

// --- LÓGICA DO MENU ---
// --- NAVEGAÇÃO DE MENUS ---

function getName() {
    const name = document.getElementById('player-name').value;
    if (!name) {
        alert("Digite um nome!");
        return null;
    }
    return name;
}

function startSinglePlayer() {
    const name = getName();
    if (!name) return;
    player.name = name;
    
    // Esconde menus e inicia
    document.getElementById('menu-overlay').style.display = 'none';
    document.querySelector('.main-card').style.filter = 'none';
    initGame();
}

function showMultiplayerMenu() {
    const name = getName();
    if (!name) return;
    player.name = name; // Salva no objeto global player
    
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('multiplayer-menu').style.display = 'block';
}

function backToMain() {
    document.getElementById('multiplayer-menu').style.display = 'none';
    document.getElementById('main-menu').style.display = 'block';
}

// --- COMUNICAÇÃO SOCKET (MULTIPLAYER) ---

function createRoom() {
    // Envia evento para o servidor
    socket.emit('create_room', player.name);
}

function joinRoom() {
    const roomId = document.getElementById('room-code-input').value.toUpperCase();
    if (!roomId) {
        alert("Digite o código da sala!");
        return;
    }
    socket.emit('join_room', { roomId: roomId, playerName: player.name });
}

// --- ESCUTANDO RESPOSTAS DO SERVIDOR ---

socket.on('room_created', (roomId) => {
    enterLobby(roomId);
    isHost = true; // Quem cria é o host
});

socket.on('joined_success', (roomId) => {
    enterLobby(roomId);
    isHost = false;
});

socket.on('error_message', (msg) => {
    alert(msg);
});

socket.on('remote_board_update', (data) => {
    // data = { id, matrix, score }
    
    // Descobre qual slot visual pertence a esse jogador
    const slotIndex = remotePlayersMap[data.id];
    
    if (slotIndex !== undefined) {
        // Atualiza Score
        const slot = document.getElementById(`remote-slot-${slotIndex}`);
        slot.querySelector('.remote-score').innerText = data.score;
        
        // Desenha o Tabuleiro Remoto
        const remoteCanvas = slot.querySelector('.remote-canvas');
        const remoteCtx = remoteCanvas.getContext('2d');
        
        // Limpa
        remoteCtx.fillStyle = '#000';
        remoteCtx.fillRect(0, 0, remoteCanvas.width, remoteCanvas.height);
        
        // Desenha a Matriz recebida
        // Precisamos ajustar a escala. O canvas remoto é pequeno (ex: 100px largura).
        // Se o tabuleiro tem 10 colunas, cada bloco tem 10px.
        const blockSize = remoteCanvas.width / 10; 
        
        data.matrix.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    remoteCtx.fillStyle = colors[value]; // Usa as mesmas cores
                    remoteCtx.fillRect(x * blockSize, y * blockSize, blockSize, blockSize);
                }
            });
        });
    }
});

// ATUALIZAÇÃO DA SALA (Sempre que alguém entra/sai)
socket.on('update_room_state', (roomData) => {
    // --- [NOVO] SALVA A LISTA DE JOGADORES NA VARIÁVEL GLOBAL ---
    currentRoomPlayers = roomData.players; 
    // -----------------------------------------------------------

    const playersListEl = document.getElementById('players-list');
    const countEl = document.getElementById('player-count');
    const startBtn = document.getElementById('btn-start-game');

    playersListEl.innerHTML = ''; // Limpa lista atual
    countEl.innerText = roomData.players.length;

    // Reconstrói a lista visual
    roomData.players.forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="${p.name === player.name ? 'is-me' : ''}">
                ${p.name} ${p.isHost ? '👑' : ''}
            </span>
        `;
        playersListEl.appendChild(li);
    });

    // Lógica do Botão Iniciar
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
    
    // Troca de tela
    document.getElementById('multiplayer-menu').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'block';
}

function broadcastGameState() {
    if (!currentRoomId) return; // Só envia se estiver online
    
    // Envia apenas o essencial: Matriz do tabuleiro e Score
    socket.emit('player_update', {
        roomId: currentRoomId,
        matrix: arena, // Sua matriz global 'arena'
        score: player.score
    });
}

// --- ONDE CHAMAR ESSA FUNÇÃO? ---
// Procure a função 'merge(arena, player)' e adicione no final dela:
// broadcastGameState();
//
// Procure a função 'arenaSweep()' e adicione no final dela também:
// broadcastGameState();

// Mapeia SocketID -> Slot HTML (0, 1 ou 2)
const remotePlayersMap = {}; 

function setupRemotePlayers() {
    // Pega a lista de jogadores atual da sala (que salvamos no update_room_state)
    // Precisamos salvar a lista globalmente quando ela chega
    // Nota: Você precisa garantir que a variável 'currentRoomPlayers' exista e seja atualizada no 'update_room_state'
    
    let slotIndex = 0;
    
    // 'currentRoomPlayers' deve ser definida globalmente no topo do arquivo: let currentRoomPlayers = [];
    // E atualizada dentro do socket.on('update_room_state') -> currentRoomPlayers = roomData.players;
    
    currentRoomPlayers.forEach(p => {
        if (p.id !== socket.id) { // Se não sou eu
            if (slotIndex < 3) {
                // Associa o ID do socket ao slot visual
                remotePlayersMap[p.id] = slotIndex;
                
                // Atualiza nome no HTML
                const slot = document.getElementById(`remote-slot-${slotIndex}`);
                slot.querySelector('.remote-name').innerText = p.name;
                
                slotIndex++;
            }
        }
    });
}

// Atualize a função requestStartGame
function requestStartGame() {
    if (!isHost) return;
    socket.emit('start_game', currentRoomId);
}

// Escuta o início do jogo
socket.on('game_started', () => {
    // Esconde o lobby
    document.getElementById('menu-overlay').style.display = 'none';
    document.querySelector('.main-card').style.filter = 'none';
    
    // Configura os oponentes visualmente
    setupRemotePlayers();
    
    // Inicia o loop
    initGame();
});

// NOTA: Remova as chamadas diretas de playerReset, updateScore e update que estavam aqui soltas
// O jogo agora só começa quando initGame() é chamado.