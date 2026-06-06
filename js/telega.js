"use strict"
//==========================================
const TELEGRAM_BOT_TOKEN = '8974814478:AAE5xVv2kKm4kJ7M--n8uufQ3q1iA6Hfirc';
const TELEGRAM_CHAT_ID = '1410289196';
const API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`


	document.addEventListener('DOMContentLoaded', function() {
          const formModal = document.getElementById('formModal');
          formModal.addEventListener('submit', formSend);
    
    async function formSend(event) {
      event.preventDefault();

    const formModal = document.getElementById('formModal');
    const formBtn = document.querySelector('.form__button')
    const formSendResult = document.querySelector('.form__send-result-modal')
    formSendResult.textContent = '';


    const { name, msg, phone } = Object.fromEntries(new FormData(formModal).entries());
    
    const text = `Заявка с сайта www.tatisweb.github.io\n Имя: ${name}!\nСообщение: ${msg}\nТелефон:${phone}`;


    try {
        formBtn.textContent = 'Отправляем...';

        const response = await fetch(API, {
            method: "POST",
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text,
            })
        })
        
        if (response.ok) {
          
             alert('Спасибо за обращение! Я свяжусь с вами в ближайшее время.');
            formModal.reset()
        } else {
            throw new Error(response.statusText);
        }

    } catch (error) {
        console.error(error);
        formSendResult.textContent = 'Заявка не отправлена! Попробуйте позже.';
        formSendResult.style.color = 'red';

    } finally {
        formBtn.textContent = 'Отправить';
    }
}

});

	document.addEventListener('DOMContentLoaded', function() {
          const formModal = document.getElementById('formPrice');
          formModal.addEventListener('submit', formSend);
    
    async function formSend(event) {
      event.preventDefault();

    const formModal = document.getElementById('formPrice');
    const formBtn = document.querySelector('.form__button')
    const formSendResult = document.querySelector('.form__send-result-modal')
    formSendResult.textContent = '';


    const { name, msg, phone } = Object.fromEntries(new FormData(formModal).entries());
    
    const text = `Заявка с сайта www.tatisweb.github.io нижняя форма\n Имя: ${name}!\nСообщение: ${msg}\nТелефон:${phone}`;


    try {
        formBtn.textContent = 'Отправляем...';

        const response = await fetch(API, {
            method: "POST",
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text,
            })
        })
        
        if (response.ok) {
          
             alert('Спасибо за обращение! Я свяжусь с вами в ближайшее время.');
            formModal.reset()
        } else {
            throw new Error(response.statusText);
        }

    } catch (error) {
        console.error(error);
        formSendResult.textContent = 'Заявка не отправлена! Попробуйте позже.';
        formSendResult.style.color = 'red';

    } finally {
        formBtn.textContent = 'Отправить';
    }
}

});

