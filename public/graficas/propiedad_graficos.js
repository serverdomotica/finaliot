for (i = 0; i < window.cantidad_widgets; i++) {
    if (window.tipo_widgets[i] == "Grafico_linea") {
        window.ctx[window.id_widgets[i]] = document.getElementById(window.id_widgets[i]).getContext('2d');
        gradient[window.id_widgets[i]] = window.ctx[window.id_widgets[i]].createLinearGradient(0, 0, 0, 400);
        gradient[window.id_widgets[i]].addColorStop(0, 'rgba(33, 147, 176,0.5)');
        gradient[window.id_widgets[i]].addColorStop(1, 'rgba(109, 213, 237,0.5)');
    }
}

window.options_chart = {
    legend: {
        display: false // <-- Ocultar legends
    },
    responsive: true,
    maintainAspectRatio: false, // ajustar grafica a contenedor
    scales: {
        yAxes: [{
            ticks: {
                beginAtZero: false,
                fontColor: "#eee", // <-- Color de labels eje Y
                fontSize: 9
            },
            gridLines: {
                color: 'rgba(255, 255, 255,0.15)' // <-- Color eje Y
            }
        }],
        xAxes: [{
            ticks: {
                beginAtZero: true,
                fontColor: "#eee", // <-- Color de labels eje X
                fontSize: 9,
                maxTicksLimit: 40
            },
            gridLines: {
                color: 'rgba(255, 255, 255,0.15)' // <-- Color eje Y
            }
        }]
    },
    plugins: {
        zoom: {
            pan: {
                enabled: true,  // Activar panoramica
                mode: 'xy', // Desplazar en el eje "x" y "y"
                speed: 1,  // Velocidad
                threshold: 10,  // Distancia minima de bandeja
            },
            zoom: {
                enabled: true,  // Activar zoom
                mode: 'xy',  // Desplazar en el eje "x" 
                drag: false, // Habilitar el comportamiento de arrastrar para hacer zoom
                speed: 0.1,
                threshold: 2,
                sensitivity: 3
            }
        }
    }
};

for (i = 0; i < window.cantidad_widgets; i++) {
    if (window.tipo_widgets[i] == "Grafico_linea") {
        window.propiedad_chart[window.id_widgets[i]] = {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    borderWidth: 1.6,
                    borderColor: 'rgb(0, 212, 255)',
                    backgroundColor: gradient[window.id_widgets[i]],
                    pointBorderWidth: 0,
                    pointRadius: 0  // Para eliminar puntos 
                }]
            },
            options: window.options_chart
        }
    }
}