"use strict"
//==========================================
const TELEGRAM_BOT_TOKEN = '7203410952:AAHbBXB0stHgBr2-lk4PAIGqZxO073oGTG8';
const TELEGRAM_CHAT_ID = '-4206244882';
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
    
    const text = `Заявка с сайта www.tatisweb.ru ${name}!\nСообщение: ${msg}\nТелефон:${phone}`;


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
          
             alert('Спасибо за обращение! Мы свяжемся с вами в ближайшее время.');
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
