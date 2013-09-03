(function(window){

// add dummy console.log for IE (TODO: remove)
if(!window.console) {
    window.console = {
        log: function() {}
    };
}

var view = require('./view');
var common = require('./common');
var config = require('./config');

// TODO: Figure out why requiring the template wasn't working
var for_bitcoin_switch_html = '' +
    '<div class="btn-group" id="for_bitcoin_selection">' +
    '   <a class="for-bitcoin-selection btn btn-success btn-large btn-home" data-for-bitcoin="true">Wager <i class="icon icon-btc"></i>.001</a>' +
    '   <a class="for-bitcoin-selection btn btn-primary btn-large btn-home">Just Play</a>' +
    '</div>';


window.initSetupButtons = function() {
    var join_random,
        $targetBtn,
        target_previous_html,
        $resetBtn = $('#reset_btn');
        $allButtons = $("#index_content").find('.btn');


    var resetButtons = function() {
        $("#for_bitcoin_selection").replaceWith($targetBtn);
        $resetBtn.addClass('hide');
        $allButtons.fadeIn('fast');
    };

    var swapForBitcoinSelection = function() {
        $allButtons.fadeOut(10);
        $targetBtn.replaceWith(for_bitcoin_switch_html);
        $resetBtn.removeClass('hide');
    };


    $("#index_content").on('click', '.join-random-selection', function(evt) {
        $targetBtn = $(evt.target);
        join_random = $targetBtn.data('join-random') || false;
        swapForBitcoinSelection();
    });

    $("#index_content").on('click', '.for-bitcoin-selection', function(evt) {
        var for_bitcoin = $(evt.target).data('forBitcoin');
        if (join_random) {
            window.location = "/join_random?for_bitcoin=" + for_bitcoin;
        } else {
            window.location = "/new_room?for_bitcoin=" + for_bitcoin;
        }
    });

    $resetBtn.click(resetButtons);
};


window.startRoom = function(room_id, arbiter_token) {
    var SIDES = ['black', 'white'];
    var socket = io.connect();
    console.log('connecting');

    function runPing() {
        var from = (new Date()).getTime();
        socket.emit('ping');
        socket.once('pong', function() {
            var to = (new Date()).getTime();
            $('#ping').text(to - from);
        });
    }
    var pingId = setInterval(runPing, config.PING_PERIOD*1000);

    socket.on('connect', function() {
        socket.emit('init', room_id);
        console.log('connected');
        $('#disconnect-message').remove();
        runPing();
    });
    socket.on('disconnect', function() {
        $('#chess-board').append('<div class="message" id="disconnect-message">You are disconnected. If you do not reconnect automatically, try refreshing the page.</div>');
        clearInterval(pingId);
    });
    socket.on('sideTaken', function(side) {
        console.log('sideTaken');
        $('#sit-' + side).attr('disabled', 'disabled');
    });
    socket.on('sideFree', function(side) {
        console.log('sidefree', side);
        $('#sit-' + side).removeAttr('disabled').removeClass('start-pressed');
    });
    socket.on('gotSide', function(side) {
        console.log('gotSide');
        $('#sit-' + side).attr('disabled', 'disabled');
        mySide = side;

        $(".button-bar > p").html("You are " + mySide + ". Click start once you are ready.");

        $('#start-game').removeAttr('disabled');
        $('.message').remove();
    });
    socket.on('startPressed', function(side) {
        $('.button-bar').fadeOut();
        $('#sit-' + side).addClass('start-pressed');
    });
    socket.on('starting', function(secs) {
        start();
        $(".button-bar").remove();
        $('.side-button').removeClass('start-pressed');
        $('.message').remove();
        $('#chess-board').append('<div class="message" id="starting-message">Game starting in <span id="starting-secs"></span> seconds</div>');
        secs -= 0; // convert to number
        function countDown() {
            if(secs === 0) {
                $('#starting-message').remove();
                clearInterval(countdownId);
                return;
            }
            $('#starting-secs').text(secs);
            secs -= 1;
        }
        countDown();
        var countdownId = setInterval(countDown, 1000);
    });

    socket.on('playerDisconnected', function(color) {
        var prettyColor = common.letter2color(color);
        $('.message').remove();
        $('#chess-board').append('<div class="message" id="disconnect-message">' + prettyColor + ' was disconnected!</div>');
        $('#start-game').removeAttr('disabled');
    });
    socket.on('gameOver', function(winner) {
        var color = common.letter2color(winner);
        var $cb = $('#chess-board');
        $cb.append('<div class="message">Game over! ' + color + ' wins!</div>');
        $('#start-game').removeAttr('disabled');
    });
    socket.on('arbiterPaid', function(args) {
        var $modal = $("#payout_modal");
        $modal.find('#winner').html(common.letter2color(args.winner));
        $modal.find('#amount').html(args.amount);
        $modal.modal('show');
    });


    $('#sit-white').click(function() {
        socket.emit('chooseSide', {color: 'white', arbiter_token: arbiter_token});
    });
    $('#sit-black').click(function() {
        socket.emit('chooseSide', {color: 'black', arbiter_token: arbiter_token});
    });
    $('#start-game').click(function() {
        $('#start-game').attr('disabled', 'disabled');
        socket.emit('startGame');
        $('.message').remove();

        // TODO: Add the share link here
        $('#chess-board').append('<div class="message" id="wait-message">Waiting for opponent to press start...</div>');
    });

    var boardView;
    var mySide;
    function start() {
        view.unbindEvents(socket);
        boardView = new view.BoardView(mySide[0]);
        view.bindEvents(socket, boardView);
        boardView.on('moveRequest', function(id, loc) {
            socket.emit('moveRequest', id, loc);
        });
        boardView.draw();
    }

};

window.buyIn = function(auth_url) {
    var openAuthWindow = function() {
        window.arbiterAuthenticationCallback = function(evt) {
            console.log("test handler");
            console.log(evt);
        };
        var authWindow = window.open(auth_url + '&app_name=Bullet Chess&redirect_url=' + window.location.href,
                         '', 'left=100,width=400,height=600,menubar=no,resizable=no,scrollbars=no,titlebar=no,top=100');
    };

    $("#open_auth_window").click(openAuthWindow);
};


})(window);
