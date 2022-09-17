/**
 * entry
 */


let blockArray = []; // Used to queue up changed blocks

// This function sanitizes string variables before being used in regexp
const eRe = (text) => {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

// Function to generate styling of text from flags
const genStyling = (code) => `${code == "i" ? "*" : ""}${code == "b" ? "**" : ""}${code == "h" ? "==" : ""}`


async function autoformatBlock(uuid) {

  const block = await logseq.Editor.getBlock(uuid);
  console.log(block)
  const isPageProperties = block["preBlock?"]

  if(isPageProperties) return;

  const settings = await getSettings(block.page.id);
  console.log(settings)

  let content = block.content
  
  settings.replace.forEach(replace => {
    replace.from.forEach(from => {
      const styling = genStyling(replace.style)
      const newText = `${styling}${replace.to ? replace.to : from}${styling}`
      const stylingRe = styling ? "(?!"+eRe(styling)+")" : ""
      const regex = new RegExp(`${stylingRe}(?!\\B)${eRe(from)}(?!\\B)${stylingRe}`,"g")
      content = content.replace(regex, newText)
    })
  })
  settings.linkPages.forEach(page => {
    page.from.forEach(from => {
      const styling = genStyling(page.style)
      const newText = `${styling}[[${page.to ? page.to : from}]]${styling}`
      content = content.replace(new RegExp(`(${eRe(from)})(?![^\[]*\])`,"g"), newText) //Make it so it searches based on styling too
    })
  })
  settings.linkBlocks.forEach(blockLink => {
    // Don't link it to itself
    if(blockLink.to.indexOf(block.uuid) == -1) {
      blockLink.from.forEach(from => {
        const styling = genStyling(blockLink.style)
        const newText = `${styling}[${from}](${blockLink.to})${styling}`
        const regex = new RegExp(`(${eRe(from)})(?![^\[]*\])`,"g")
        content = content.replace(regex, newText)
      })
    }
  })

  // Change the actual text
  await logseq.Editor.updateBlock(block.uuid, content)

}

async function getSettings(pageId) {
  const page = await logseq.Editor.getPage(pageId)
  const propBlock = await getPropertiesBlock(page)
  
  return parseSettings(propBlock)
}

function parseSettings(propBlock) {
  const settings = {replace: [], linkPages: [], linkBlocks: [], pageId: propBlock.page.id}
  const props = {...propBlock.properties}
  console.log(props)
  if(props.autoformaterReplace) settings.replace.push(...parseSetting(props.autoformaterReplace))
  if(props.autoformaterLinkPages) settings.linkPages.push(...parseSetting(props.autoformaterLinkPages))
  if(props.autoformaterLinkBlocks) settings.linkBlocks.push(...parseSetting(props.autoformaterLinkBlocks))

  return settings
}

function parseSetting(string) {
  const setting = [];
  const re = /\{(?<from>[^\{\}\:\;]+)(:(?<to>[^\{\}\:\;]+))?\;*(?<style>\w{1})?\}\;?/g
  //TODO add validation for the settings so you get an errormessage if your thing is formated the wrong way
  let m;
  do {
    m = re.exec(string)
    if(m) setting.push({from: m.groups?.from.split("&"), to: m.groups?.to, style: m.groups?.style})
  } while(m);

  return setting
}

async function saveSettings(settings){
  const settingObjToString = ({from, to, style}) => {
    return "{" + from.join("&") + (to ? `:${to}` : "") + (style ? `;${style}` : "") + "}"
  }

  const settingToString = (settingString, settingObj) => {
    return settingString+settingObjToString(settingObj)+";"
  }


  const replace = settings.replace.reduce(settingToString, "")

  const linkBlocks = settings.linkBlocks.reduce(settingToString, "")

  const linkPages = settings.linkPages.reduce(settingToString, "")

  const page = await logseq.Editor.getPage(settings.pageId)
  const propBlock = await getPropertiesBlock(page)

  await logseq.Editor.upsertBlockProperty(propBlock.uuid, "autoformater-replace", replace)
  await logseq.Editor.upsertBlockProperty(propBlock.uuid, "autoformater-link-blocks", linkBlocks)
  await logseq.Editor.upsertBlockProperty(propBlock.uuid, "autoformater-link-pages", linkPages)

}

async function getPropertiesBlock(page) {
  const firstBlock = (await logseq.Editor.getPageBlocksTree(page.name))[0]
  console.log(firstBlock)
  // If the first block is a properties block
  if(firstBlock["preBlock?"]){
    console.log(firstBlock)
    return firstBlock
  } else {
    //TODO make a properties block
    logseq.App.showMsg("No properties block on page")
    return null
  }
}

async function createNewBlockLink(e){
  // Since mode: "editing" doesn't work so well with shortcuts I choose this solution
  if(!e.uuid) {
    logseq.App.showMsg("You have to be in a block to create a autolink")
    return
  }

  const block = await logseq.Editor.getBlock(e.uuid)
  const page = await logseq.Editor.getPage(block.page.id, {includeChildren: true})


  // Sees if there are any def's to be made
  const sign = "~"

  // Generates a regex that matches eg. ~hei~
  const genSingleRegex = (ds, matchContent) => {
    const content = matchContent ? `(?<term>${matchContent})` : `(?<term>[^${eRe(ds)}]+)`
    return new RegExp(`(${eRe(ds)}){1}${content}(${eRe(ds)}){1}`, "g")
  }
  //const genSingleRegex = (matchContent, definitionSign) => new RegExp(`([^${eRe(definitionSign)}]|^)(${eRe(definitionSign)}{1})(?<term>${eRe(matchContent)})(${eRe(definitionSign)}{1})([^${eRe(definitionSign)}]|$)`, "g")
  
  const re = genSingleRegex(sign)
  const terms = [];
  let m;
  do {
    m = re.exec(block.content)
    if(m) terms.push(m.groups?.term)
  } while (m);

  if(terms.length == 0) {
    logseq.App.showMsg(`Couldn't find a term!`)
    return
  }

  //Makes sure the terms are shorted from longest to shortest, makes it easier with replaces etc.
  terms.sort((a, b) => {
    return b.length - a.length;
  });

  const settings = await getSettings(block.page.id)

  let indexOfExistingLink;
  let alreadyDefined
  settings.linkBlocks.forEach((link, i) => {
    link.from.forEach(from => {
      if(terms.indexOf(from) > -1) {
        alreadyDefined = from
      }
    })

    if(link.to?.includes(block.uuid)) {
      indexOfExistingLink = i // If the block has definitions already, add the new ones to it
    }

  })

  if(alreadyDefined) {
    logseq.App.showMsg(`"${alreadyDefined}" is already defined!`)
    return
  }

  if (indexOfExistingLink != undefined) {
    settings.linkBlocks[indexOfExistingLink].from.push(...terms)
  } else {
    settings.linkBlocks.push({
      from: terms,
      to: `((${block.uuid}))`,
      style: "i"
    })
  }


  // Replaces all the terms with styled terms
  let newText = block.content
  settings.linkBlocks.forEach(setting => {
    setting.from.forEach(from => {
      //const style = genStyling(setting.style)
      const style = "**"
      console.log(newText)
      newText = newText.replace(genSingleRegex(sign, from), `${style}${from}${style}`)
    })
  })

  console.log(newText)

  await logseq.Editor.updateBlock(block.uuid, newText)
  await saveSettings(settings)
  logseq.App.showMsg(`"You defined ${terms.join(", ")}"!`)
    
}

async function createNewPageLink(e){
  // Since mode: editing doesn't work so well with shortcuts I choose this solution
  if(!e.uuid) {
    logseq.App.showMsg("You have to be in a block to create a definition")
    return
  }

  const block = await logseq.Editor.getBlock(e.uuid)

  const re = /(\[\[)(?<term>[^\*]+)(\]\])/g
  const terms = [];
  let m;
  do {
    m = re.exec(block.content)
    if(m) terms.push(m.groups?.term)
  } while (m);

  if(terms.length == 0) {
    logseq.App.showMsg(`Couldn't find a term!`)
    return
  }

  //Makes sure the terms are shorted from longest to shortest, makes it easier with replaces etc.
  terms.sort((a, b) => {
    return b.length - a.length;
  });

  const settings = await getSettings(block.page.id)
  let indexOfExistingPage;
  let alreadyDefined
  settings.linkPages.forEach((page, i) => {
    page.from.forEach(from => {
      if(terms.indexOf(from) > -1) {
        alreadyDefined = from
      }
    })

    if(page.to?.includes(block.uuid)) {
      indexOfExistingPage = i // If the block has definitions already, add the new ones to it
    }
  })

  if(alreadyDefined) {
    logseq.App.showMsg(`"${alreadyDefined}" is already defined!`)
    return
  }

  if (indexOfExistingPage != undefined) {
    settings.linkPages[indexOfExistingPage].from.push(...terms)
  } else {
    settings.linkPages.push({
      from: terms,
      style: null
    })
  }

  await saveSettings(settings)
  logseq.App.showMsg(`"You autolinked pages: ${terms.join(", ")}"!`)
}

function main () {
  //logseq.App.showMsg('❤️ Message from Hello World Plugin :)')

  
  logseq.Editor.registerBlockContextMenuItem("autoformat", (e) => autoformatBlock(e.uuid))
  logseq.App.registerCommandShortcut({ binding: "ctrl+q" }, createNewBlockLink)
  logseq.App.registerCommandShortcut({ binding: "ctrl+shift+q" }, createNewPageLink)

  
  // Handle autoformatting live
  logseq.DB.onChanged(async (e) => {
    const addBlock = uuid => {
      // TODO I think this section ca be removed
      if (uuid && !blockArray.includes(uuid)) {
        blockArray.push(uuid);
      }
    }

    addBlock(e.blocks[0].uuid)


    console.log(e.txMeta?.outlinerOp)
    if (e.txMeta?.outlinerOp == "insertBlocks") {
      blockArray.forEach((block, i) => {
        autoformatBlock(block)
      })

      blockArray = []

    }
  });

  console.log("autoformater has loaded")
}

// bootstrap
logseq.ready(main).catch(console.error)
