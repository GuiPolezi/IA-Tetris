const express = require('express');
const http = require('http');
const { Server } = require("socket.io"); // Importação deve vir antes do uso

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const path = require('path'); // Adicione o require('path') no topo
// --- CORREÇÃO: Servir arquivos da Raiz (Root) ---
// Se seus arquivos index.html, style.css e script.js estão na mesma pasta do server.js:
// Ajuste para servir a pasta estática correta
app.use(express.static(path.join(__dirname, 'public'))); // Se a pasta chamar 'public'

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ESTADO DO SERVIDOR
const rooms = {}; 

function generateRoomId() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. CRIAR SALA
    socket.on('create_room', (playerName) => {
        const roomId = generateRoomId();
        
        rooms[roomId] = {
            players: [],
            gameStarted: false
        };

        const player = { id: socket.id, name: playerName, isHost: true, alive: true };
        rooms[roomId].players.push(player);
        
        socket.join(roomId);
        socket.emit('room_created', roomId);
        io.to(roomId).emit('update_room_state', rooms[roomId]);
    });

    // 2. ENTRAR EM SALA
    socket.on('join_room', (data) => {
        const { roomId, playerName } = data;
        const room = rooms[roomId];

        if (room) {
            if (room.players.length >= 4) {
                socket.emit('error_message', 'A sala está cheia!');
                return;
            }
            if (room.gameStarted) {
                socket.emit('error_message', 'O jogo já começou!');
                return;
            }

            const player = { id: socket.id, name: playerName, isHost: false, alive: true };
            room.players.push(player);
            
            socket.join(roomId);
            socket.emit('joined_success', roomId);
            io.to(roomId).emit('update_room_state', room);
            
        } else {
            socket.emit('error_message', 'Sala não encontrada!');
        }
    });

    // 3. JOGADOR MORREU (Lógica de Vitória)
    socket.on('player_died', (roomId) => {
        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;

        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.alive = false;
            io.to(roomId).emit('player_eliminated', socket.id);
        }

        const livingPlayers = room.players.filter(p => p.alive);

        if (livingPlayers.length === 1) {
            // Temos um vencedor!
            const winner = livingPlayers[0];
            io.to(roomId).emit('game_over_winner', winner);
            
            room.gameStarted = false;
            room.players.forEach(p => p.alive = true);
        } 
        else if (livingPlayers.length === 0) {
            // Empate
            io.to(roomId).emit('game_over_draw');
            room.gameStarted = false;
            room.players.forEach(p => p.alive = true);
        }
    });

    // 4. DESCONEXÃO
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                const wasHost = room.players[playerIndex].isHost;
                room.players.splice(playerIndex, 1);
                
                if (room.players.length === 0) {
                    delete rooms[roomId];
                } else {
                    if (wasHost) {
                        room.players[0].isHost = true;
                    }
                    io.to(roomId).emit('update_room_state', room);
                }
                break;
            }
        }
    });

    // 5. INICIAR JOGO
    socket.on('start_game', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            room.gameStarted = true;
            io.to(roomId).emit('game_started');
        }
    });

    // 6. SYNC
    socket.on('player_update', (data) => {
        const { roomId, matrix, score } = data;
        socket.to(roomId).emit('remote_board_update', {
            id: socket.id,
            matrix: matrix,
            score: score
        });
    });

    // 7. SOFT RESET (Voltar ao Lobby)
    socket.on('reset_lobby', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            room.gameStarted = false;
            room.players.forEach(p => p.alive = true);
            io.to(roomId).emit('return_to_lobby');
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});