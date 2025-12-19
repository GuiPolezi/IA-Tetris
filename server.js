const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Serve os arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Configuração básica do Socket.io (usaremos na próxima etapa)
io.on('connection', (socket) => {
    console.log('Um jogador conectou ID:', socket.id);

    socket.on('disconnect', () => {
        console.log('Jogador desconectou:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});