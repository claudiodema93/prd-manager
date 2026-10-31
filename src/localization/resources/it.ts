export const it = {
  appName: "PrdManager",
  customersClearFilters: "Azzera filtri",
  customersColumnActions: "Azioni",
  customersColumnArticles: "Articoli",
  customersColumnCode: "Codice",
  customersColumnCustomer: "Cliente",
  customersColumnStatus: "Stato",
  customersColumnUpdated: "Aggiornato",
  customersCreateDescription:
    "Crea un nuovo cliente e definisci come vengono generati i codici di articoli e revisioni.",
  customersCreateSuccess: "Cliente creato.",
  customersCreateTitle: "Nuovo cliente",
  customersDelete: "Sposta nel cestino",
  customersDeleteBlockedDescription_one:
    "Il cliente contiene 1 articolo. Rimuovilo prima di spostarlo nel cestino.",
  customersDeleteBlockedDescription_other:
    "Il cliente contiene {{count}} articoli. Rimuovili prima di spostarlo nel cestino.",
  customersDeleteBlockedTooltip_one:
    "Spostamento non disponibile: il cliente ha 1 articolo.",
  customersDeleteBlockedTooltip_other:
    "Spostamento non disponibile: il cliente ha {{count}} articoli.",
  customersDeleteConfirm: "Sposta nel cestino",
  customersDeleteCustomer: "Sposta {{name}} nel cestino",
  customersDeleteDeleting: "Spostamento…",
  customersDeleteDescription:
    "Il cliente «{{name}}» ({{code}}) verrà spostato nella cartella cestino configurata. L'operazione non può essere annullata dall'applicazione.",
  customersDeleteSuccess: "Cliente spostato nel cestino.",
  customersDeleteTitle: "Spostare il cliente nel cestino?",
  customersDeleteTrashMissing:
    "La cartella cestino non è configurata: lo spostamento non andrà a buon fine finché non la imposti nelle preferenze.",
  customersDescription:
    "Gestisci l'anagrafica clienti e le regole di generazione dei codici.",
  customersDismiss: "Chiudi messaggio",
  customersEdit: "Modifica",
  customersEditCustomer: "Modifica {{name}}",
  customersEditDescription:
    "Aggiorna i dati del cliente e le regole di generazione dei codici.",
  customersEditTitle: "Modifica cliente",
  customersEmptyDescription:
    "Non ci sono ancora clienti nella cartella articoli. Creane uno per iniziare.",
  customersEmptyTitle: "Nessun cliente",
  customersErrorBadRequest:
    "I dati inseriti non sono validi. Controlla i campi e riprova.",
  customersErrorConflict:
    "Operazione non consentita: il codice è già in uso o il cliente contiene articoli.",
  customersErrorGeneric: "Si è verificato un errore imprevisto. Riprova.",
  customersErrorNotFound: "Cliente non trovato. Aggiorna l'elenco e riprova.",
  customersErrorPrecondition:
    "Configurazione mancante o non valida. Controlla la cartella articoli e il cestino.",
  customersFiltersEmptyDescription:
    "Modifica la ricerca o lo stato selezionato.",
  customersFiltersEmptyTitle: "Nessun cliente corrisponde ai filtri",
  customersFoldersLoadError:
    "Impossibile caricare la configurazione delle cartelle.",
  customersFormAddParameter: "Aggiungi parametro",
  customersFormArticle: "Articoli",
  customersFormArticleDescription:
    "Regola usata per generare il codice degli articoli.",
  customersFormCancel: "Annulla",
  customersFormClose: "Chiudi",
  customersFormCodeFolder: "Cartella: {{folderName}}",
  customersFormCodeHelper:
    "4 cifre, da 0001 a 9999. Se vuoto viene assegnato automaticamente.",
  customersFormCodeLabel: "Codice cliente",
  customersFormCodePlaceholder: "Automatico",
  customersFormDiscardCancel: "Continua a modificare",
  customersFormDiscardConfirm: "Esci senza salvare",
  customersFormDiscardDescription:
    "Se chiudi ora, le modifiche inserite andranno perse.",
  customersFormDiscardTitle: "Modifiche non salvate",
  customersFormErrorBoolDefault: "Usa true, false, 1 o 0.",
  customersFormErrorCode: "Il codice deve essere di 4 cifre, da 0001 a 9999.",
  customersFormErrorDuplicateParameter: "Nome parametro duplicato.",
  customersFormErrorKeyNoPlaceholder:
    "Il modello deve contenere almeno un segnaposto, ad esempio {CODE}.",
  customersFormErrorKeyPlaceholder:
    "Il modello usa un segnaposto non dichiarato tra i parametri.",
  customersFormErrorKeyRequired: "Inserisci un modello di chiave.",
  customersFormErrorKeyTooLong:
    "Il modello di chiave è troppo lungo (massimo 512 caratteri).",
  customersFormErrorName: "Inserisci il nome del cliente.",
  customersFormErrorNumberDefault:
    "Il valore predefinito numerico deve contenere solo cifre.",
  customersFormErrorParameterName:
    "Usa lettere maiuscole, cifre e underscore, con iniziale maiuscola (massimo 64 caratteri).",
  customersFormErrorParameterRequired: "Aggiungi almeno un parametro.",
  customersFormIssuesTitle: "Problemi rilevati",
  customersFormKeyExample: "Esempio: {CODE}[_EVO{EVO:00}]",
  customersFormKeyHelper:
    "Usa {PARAM}, {PARAM:00} per la larghezza e le parentesi quadre per i segmenti opzionali.",
  customersFormKeyLabel: "Modello chiave",
  customersFormKeyLockedOne: "Non modificabile: il cliente ha 1 articolo.",
  customersFormKeyLockedOther:
    "Non modificabile: il cliente ha {{count}} articoli.",
  customersFormKeyNamesLocked:
    "I nomi usati nel modello chiave non sono modificabili finché il cliente ha articoli.",
  customersFormMetadataBlocked:
    "Il cliente contiene articoli e la configurazione non può essere riparata da qui. Correggi i file del cliente manualmente.",
  customersFormMetadataMissingDescription:
    "Il cliente non ha una configurazione valida. Inserisci nome, articoli e revisioni per ripararla.",
  customersFormMetadataMissingTitle: "Configurazione non disponibile",
  customersFormNameLabel: "Nome cliente",
  customersFormNamePlaceholder: "Es. Rossi Impianti",
  customersFormParameterDefault: "Predefinito (opzionale)",
  customersFormParameterDefaultPlaceholder: "Facoltativo",
  customersFormParameterHeading: "Parametro {{index}}",
  customersFormParameterName: "Nome",
  customersFormParameterRequired: "Obbligatorio",
  customersFormParametersTitle: "Parametri",
  customersFormParameterType: "Tipo",
  customersFormRemoveParameter: "Rimuovi parametro {{index}}",
  customersFormRequired: "obbligatorio",
  customersFormRevision: "Revisioni",
  customersFormRevisionDescription:
    "Regola usata per generare il codice delle revisioni.",
  customersFormSave: "Salva",
  customersFormSaving: "Salvataggio…",
  customersFormTypeBool: "Booleano",
  customersFormTypeNumber: "Numero",
  customersFormTypeText: "Testo",
  customersFormValidationSummary:
    "Alcuni campi non sono validi. Controlla i campi evidenziati.",
  customersIssueArticleInvalid:
    "Uno o più articoli hanno una configurazione non valida.",
  customersIssueArticleSymlink:
    "Un articolo è un collegamento simbolico e non viene gestito.",
  customersIssueConfigInvalid: "La configurazione del cliente non è valida.",
  customersIssueConfigInvalidJson:
    "La configurazione del cliente non è un JSON valido.",
  customersIssueConfigMissing: "La configurazione del cliente è assente.",
  customersIssueConfigUnreadable:
    "La configurazione del cliente non è leggibile.",
  customersIssueEntryUnexpected: "La cartella contiene un elemento inatteso.",
  customersIssueError: "Errore",
  customersIssueFolderNotDirectory:
    "La cartella del cliente non è una directory.",
  customersIssueFolderSymlink:
    "La cartella del cliente è un collegamento simbolico.",
  customersIssueFolderUnreadable: "La cartella del cliente non è leggibile.",
  customersIssueRootMissing: "La cartella articoli non esiste.",
  customersIssueRootNotDirectory: "La cartella articoli non è una directory.",
  customersIssueRootSymlink:
    "La cartella articoli è un collegamento simbolico.",
  customersIssueRootUnreadable: "La cartella articoli non è leggibile.",
  customersIssueWarning: "Avviso",
  customersLoadError: "Impossibile caricare i clienti.",
  customersLoading: "Caricamento clienti…",
  customersNew: "Nuovo cliente",
  customersNextPage: "Pagina successiva",
  customersNoRootDescription:
    "Per gestire i clienti devi prima configurare la cartella articoli nelle impostazioni.",
  customersNoRootTitle: "Cartella articoli non configurata",
  customersOpenFolders: "Apri impostazioni cartelle",
  customersPreviousPage: "Pagina precedente",
  customersRange: "{{from}}–{{to}} di {{total}}",
  customersRefresh: "Aggiorna",
  customersRefreshScanning: "Scansione…",
  customersRetry: "Riprova",
  customersScanFolder: "Scansiona cartella",
  customersScanIncomplete:
    "Scansione incompleta: {{scanned}} cartelle esaminate. Controlla i problemi riportati qui sotto.",
  customersScanIssuesMore: "E altri {{remaining}} problemi.",
  customersScanIssuesTitle: "Problemi durante la scansione",
  customersScanSummary:
    "Scansione completata: {{scanned}} cartelle esaminate, {{created}} clienti creati, {{updated}} aggiornati, {{removed}} rimossi, {{unchanged}} invariati.",
  customersSearchLabel: "Cerca",
  customersSearchPlaceholder: "Cerca per nome, codice o cartella",
  customersStatusAll: "Tutti",
  customersStatusError: "Errore",
  customersStatusFilterLabel: "Stato",
  customersStatusOk: "Ok",
  customersStatusWarning: "Attenzione",
  customersTableCaption:
    "Elenco dei clienti con codice, numero di articoli, stato e data di aggiornamento.",
  customersTechnicalDetails: "Dettagli tecnici",
  customersTitle: "Clienti",
  customersUpdateSuccess: "Cliente aggiornato.",
  displayDescription: "Personalizza l'aspetto e la lingua dell'applicazione.",
  displayTitle: "Schermo",
  documentation: "Documentazione",
  folderArticlesDescription: "Cartella in cui vengono salvati gli articoli.",
  folderArticlesLabel: "Cartella articoli",
  folderBrowse: "Sfoglia",
  folderChoose: "Scegli cartella",
  folderClear: "Rimuovi",
  folderIssuesDescription: "Cartella in cui vengono salvate le issue.",
  folderIssuesLabel: "Cartella issue",
  folderLoadError: "Impossibile caricare le cartelle.",
  folderNotSelected: "Nessuna cartella selezionata",
  folderPickerTitle: "Seleziona una cartella",
  folderSaveError: "Impossibile salvare la cartella selezionata.",
  foldersDescription: "Scegli le cartelle usate per articoli, issue e cestino.",
  foldersTitle: "Cartelle",
  folderTrashDescription: "Cartella in cui finiscono gli elementi eliminati.",
  folderTrashLabel: "Cartella cestino",
  languageDescription: "Scegli la lingua dell'interfaccia.",
  languageLabel: "Lingua",
  madeBy: "Creato da Claudio De Martino",
  navigation: "Navigazione",
  settings: "Impostazioni",
  settingsDescription: "Gestisci le preferenze dell'applicazione.",
  settingsNavDisplay: "Schermo",
  settingsNavFolders: "Cartelle",
  settingsNavGeneral: "Generale",
  themeDark: "Scuro",
  themeDescription: "Scegli l'aspetto dell'interfaccia.",
  themeLabel: "Tema",
  themeLight: "Chiaro",
  themeSystem: "Sistema",
  titleCustomers: "Clienti",
  titleHomePage: "Pagina iniziale",
  titleSecondPage: "Seconda pagina",
  titleSettings: "Impostazioni",
  titleSettingsDisplay: "Schermo",
  titleSettingsFolders: "Cartelle",
  titleSettingsGeneral: "Generale",
} as const;

export type TranslationKey = keyof typeof it;
