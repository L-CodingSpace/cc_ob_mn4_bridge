property appProcessName : "MarginNote 4"
property firstChoiceButton : "否"
property saveButtonNames : {"存储", "保存", "Save"}
property maxSearchDepth : 5

on run
	tell application "System Events"
		if not (exists process appProcessName) then
			error "未找到进程：" & appProcessName
		end if
		
		tell process appProcessName
			set frontmost to true
		end tell
	end tell
	
	if my clickButtonWhenVisible(appProcessName, firstChoiceButton, 2) is false then
		my clickRelativeToFrontWindow(appProcessName, 0.29, 0.84)
	end if
	
	if my clickAnyButtonWhenVisible(appProcessName, saveButtonNames, 10) is false then
		error "没有找到保存按钮：" & my joinText(saveButtonNames, " / ")
	end if
end run

on clickAnyButtonWhenVisible(processName, buttonNames, timeoutSeconds)
	repeat with buttonName in buttonNames
		if my clickButtonWhenVisible(processName, buttonName as text, timeoutSeconds) then return true
	end repeat
	return false
end clickAnyButtonWhenVisible

on clickButtonWhenVisible(processName, buttonName, timeoutSeconds)
	set deadline to (current date) + timeoutSeconds
	repeat while (current date) is less than deadline
		tell application "System Events"
			tell process processName
				try
					set candidateWindows to windows
					repeat with candidateWindow in candidateWindows
						if my clickButtonInElement(candidateWindow, buttonName, 0) then return true
					end repeat
				end try
			end tell
		end tell
		delay 0.1
	end repeat
	return false
end clickButtonWhenVisible

on clickButtonInElement(rootElement, buttonName, depth)
	if depth is greater than maxSearchDepth then return false
	
	tell application "System Events"
		try
			set elementText to my accessibilityText(rootElement)
			if elementText contains buttonName then
				try
					set elementRole to role of rootElement
				on error
					set elementRole to ""
				end try
				
				if elementRole is "AXButton" or elementRole is "AXGroup" or elementRole is "AXStaticText" then
					click rootElement
					return true
				end if
			end if
			
			set childElements to UI elements of rootElement
			repeat with childElement in childElements
				if my clickButtonInElement(childElement, buttonName, depth + 1) then return true
			end repeat
		end try
	end tell
	return false
end clickButtonInElement

on clickRelativeToFrontWindow(processName, xRatio, yRatio)
	tell application "System Events"
		tell process processName
			set frontmost to true
			set windowPosition to position of window 1
			set windowSize to size of window 1
			set clickX to (item 1 of windowPosition) + ((item 1 of windowSize) * xRatio)
			set clickY to (item 2 of windowPosition) + ((item 2 of windowSize) * yRatio)
			click at {clickX, clickY}
		end tell
	end tell
	delay 0.2
end clickRelativeToFrontWindow

on accessibilityText(rootElement)
	set textParts to {}
	tell application "System Events"
		try
			set end of textParts to name of rootElement
		end try
		try
			set end of textParts to title of rootElement
		end try
		try
			set end of textParts to description of rootElement
		end try
		try
			set end of textParts to value of rootElement
		end try
	end tell
	return my joinText(textParts, " ")
end accessibilityText

on joinText(textList, delimiter)
	set previousTextItemDelimiters to AppleScript's text item delimiters
	set AppleScript's text item delimiters to delimiter
	set joinedText to textList as text
	set AppleScript's text item delimiters to previousTextItemDelimiters
	return joinedText
end joinText
