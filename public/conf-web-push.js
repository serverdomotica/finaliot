const PUBLIC_VAPID_KEY = 'BHV8nPbclKotvf6O_y1ahCe4-XBl-AEx3aXmC70JmSOdlqJHMnMfnZm23oChg1h5Vkv6DVoKVzfydzs0qabN01Q'

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i)
        outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}

const subscription = async () => {
    // Service worker
    const register = await navigator.serviceWorker.register('/worker.js', { scope: '/' });
    console.log("New server worker");

    const subscription = await register.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
    });

    await fetch('/subscription', {
        method: 'POST',
        body: JSON.stringify(subscription),
        headers: {
            "Content-Type": "application/json"
        }
    });
    console.log("suscrito");
}

subscription();