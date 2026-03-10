function loadGoogleFont(names) {
   WebFont.load({
    google: {
      families: [names]
    }
  });
  
}


function fullScreenToggle() {
  var fs = fullscreen();
  fullscreen(!fs);
}




function windowResized() {
/*  resizeCanvas(windowWidth, windowHeight);*/
}


function noScrolling() {
  /*document.addEventListener('touchstart', function(event) {
    event.preventDefault();
  }, {
    passive: false
  });*/
}


// ENCRYPT DECRYPT CODE

// #########
// SOLUTION #2: USE THIS TO STORE A KEY IN YOUR BROWSERS STORAGE
// This solution stores a key in your browsers local storage so you do not have to
// #########

// apiKey= getStoredKey("apikeyname");
// print(apiKey);

// #########
///SOLUTION #3: ENCRYPTED KEY AND ADD TO YOUR CODE
// This solution encrypts a key that you add to your code a prompt will ask for password
// fill out the password prompt everytime you run the sketch
// The password is: flowmeter
// #########

// apiKey = deCryptKeyPrompt({apiKeyEncrypted});
// print(apiKey);



function storedDecrypt(secretKeyVariable) {
  let name = Object.keys(secretKeyVariable)[0];
  let encryptedKey = Object.values(secretKeyVariable)[0];
  if (!encryptedKey || encryptedKey == "") {
      encryptKeyPrompt(name);
  }
  let password = getStoredKey(name, "password");

  return decryptKey(encryptedKey, password);
}

function getStoredKey(name, promptTxt = "key") {
  let keDecrypted = getKey(name);
  if (!keDecrypted) {
    keyDecrypted = prompt("Please enter " + promptTxt + "(" + name + "):", "");
    if (keyDecrypted) {
      storeKey(name, keyDecrypted);
      return keyDecrypted;
    } else {
      return null;
    }
  }
  return keDecrypted;
}

function decryptKey(encryptedKey, password) {
  if (password) {
    let decryptedKey = CryptoJS.AES.decrypt(encryptedKey, password);
    return decryptedKey.toString(CryptoJS.enc.Utf8);
  }
}

function deCryptKeyPrompt(secretKeyVariable) {
  let name = Object.keys(secretKeyVariable)[0];
  let encryptedKey = Object.values(secretKeyVariable)[0];
  if (!encryptedKey || encryptedKey == "") {
    encryptKeyPrompt(name);
  }
  let password = getStoredKey(name, "password");

  return decryptKey(encryptedKey, password);
}

function encryptKey(key, password) {
  if (key && password) {
    return CryptoJS.AES.encrypt(key, password);
  }
}

function encryptKeyPrompt(variablename) {
  let key = prompt("Please enter key:", "");
  let password = prompt("Please enter password for " + variablename, "");
  let encryptedKey = encryptKey(key, password);
  print("##### INSERT THE CODE BELOW IN YOUR SKETCH ###");
  print("let " + variablename + ' ="' + encryptedKey + '"');
}

let storage_password = "sdlkjwelkfjwelkj"; // local storage password, not perfect but better than storing values in clear text.
function storeKey(name, key) {
  keyEncrypted = encryptKey(key, storage_password);
  window.localStorage.setItem(name, keyEncrypted);
}

function getKey(name) {
  let keyEncrypted = window.localStorage.getItem(name);
  if (keyEncrypted) return decryptKey(keyEncrypted, storage_password);
  else return null;
}