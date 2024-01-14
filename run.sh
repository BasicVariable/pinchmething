cd "./JS"
if [ ! -f "./package-lock.json" ]; then 
    rm -rf "./node_modules/"
    echo "Installing npm modules..."
    npm install
fi;
node index.js