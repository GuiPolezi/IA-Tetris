const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ESTADO DO SERVIDOR
// Estrutura: { 'SALA_ID': { players: [{id, name, isHost}], gameStarted: false } }
const rooms = {}; 

// Função auxiliar para gerar ID de sala (4 letras aleatórias)
function generateRoomId() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. CRIAR SALA
    socket.on('create_room', (playerName) => {
        const roomId = generateRoomId();
        
        // Cria a sala no servidor
        rooms[roomId] = {
            players: [],
            gameStarted: false
        };

        // Adiciona o jogador como HOST
        const player = { id: socket.id, name: playerName, isHost: true };
        rooms[roomId].players.push(player);
        
        socket.join(roomId); // Função do Socket.io para agrupar conexões
        
        // Responde para quem criou
        socket.emit('room_created', roomId);
        // Atualiza a lista para todos na sala (no caso, só ele)
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

            // Adiciona jogador
            const player = { id: socket.id, name: playerName, isHost: false };
            room.players.push(player);
            
            socket.join(roomId);
            
            // Avisa o cliente que deu certo
            socket.emit('joined_success', roomId);
            // Atualiza a lista para TODOS na sala
            io.to(roomId).emit('update_room_state', room);
            
        } else {
            socket.emit('error_message', 'Sala não encontrada!');
        }
    });

    // 3. DESCONEXÃO
    socket.on('disconnect', () => {
        // Precisamos encontrar em qual sala o jogador estava para removê-lo
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);
                
                // Se a sala ficou vazia, deleta a sala
                if (room.players.length === 0) {
                    delete rooms[roomId];
                } else {
                    // Se o HOST saiu, passa a liderança para o próximo
                    // (Lógica simplificada: se quem saiu era host, o primeiro da lista vira host)
                    // Para este MVP, vamos apenas atualizar a lista
                    io.to(roomId).emit('update_room_state', room);
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});